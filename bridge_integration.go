package main

import (
  "bytes"
  "crypto/hmac"
  "crypto/sha256"
  "encoding/base64"
  "encoding/json"
  "fmt"
  "html"
  "io"
  "net/http"
  "net/url"
  "os"
  "strings"
  "time"

  "github.com/julienschmidt/httprouter"
)

var bridgeClient = &http.Client{Timeout: 12 * time.Second}
func bridgeBase() string {
  base:=os.Getenv("CLOUDPATRON_BRIDGE_URL")
  if base=="" { base="http://127.0.0.1:8091" }
  return strings.TrimRight(base,"/")
}
func bridgeCall(method,path string,body []byte, private bool)(int,[]byte,error){
  req,err:=http.NewRequest(method,bridgeBase()+path,bytes.NewReader(body))
  if err!=nil{return 0,nil,err}
  if len(body)>0 {req.Header.Set("Content-Type","application/json")}
  if private {
    secret:=os.Getenv("BRIDGE_API_TOKEN")
    if len(secret)<32{return 0,nil,fmt.Errorf("bridge administrator token not configured")}
    req.Header.Set("Authorization","Bearer "+secret)
  }
  response,err:=bridgeClient.Do(req)
  if err!=nil{return 0,nil,err}
  defer response.Body.Close()
  payload,err:=io.ReadAll(io.LimitReader(response.Body,1024*1024))
  return response.StatusCode,payload,err
}
func bridgeSession(r *http.Request)(*Session,bool){
  session,err:=validateSession(r)
  if err!=nil{return nil,false}
  if !session.Admin {
    if session.PatronID=="" {return nil,false}
    if _,err:=database.FindPatron(session.PatronID);err!=nil{return nil,false}
  }
  return session,true
}
func bridgeCSRF(r *http.Request)string{
  cookie,err:=r.Cookie(sessionCookieName)
  if err!=nil{return ""}
  mac:=hmac.New(sha256.New,[]byte(database.FindInfo().SecureToken.HashKey))
  mac.Write([]byte("bridge-csrf-v1:"))
  mac.Write([]byte(cookie.Value))
  return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func bridgeCheckCSRF(r *http.Request,received string)bool{
  expected:=bridgeCSRF(r)
  return expected!=""&&len(expected)==len(received)&&hmac.Equal([]byte(expected),[]byte(received))
}
func bridgeSameOrigin(r *http.Request)bool{
  origin:=r.Header.Get("Origin")
  if origin=="" {return false}
  u,err:=url.Parse(origin)
  if err!=nil{return false}
  return u.Host==r.Host&&(u.Scheme=="https" || (u.Scheme=="http" && (r.Host=="localhost"||strings.HasPrefix(r.Host,"localhost:"))))
}
func bridgeJSON(w http.ResponseWriter,status int,body []byte){
  w.Header().Set("Content-Type","application/json; charset=utf-8")
  w.Header().Set("Cache-Control","no-store")
  w.Header().Set("X-Content-Type-Options","nosniff")
  w.WriteHeader(status)
  w.Write(body)
}
func bridgeError(w http.ResponseWriter,status int,message string){
  b,_:=json.Marshal(map[string]string{"error":message})
  bridgeJSON(w,status,b)
}
func bridgeSessionAPI(w http.ResponseWriter,r *http.Request,_ httprouter.Params) {
  session,ok:=bridgeSession(r)
  if !ok {bridgeJSON(w,200,[]byte(`{"authenticated":false}`));return}
  data,_:=json.Marshal(map[string]interface{}{"authenticated":true,"admin":session.Admin,"csrf":bridgeCSRF(r)})
  bridgeJSON(w,200,data)
}
func bridgePublicProxy(w http.ResponseWriter,r *http.Request,ps httprouter.Params){
  if r.Method!="GET" {http.NotFound(w,r);return}
  path:=ps.ByName("path")
  if path==""||strings.Contains(path,".."){http.NotFound(w,r);return}
  status,data,err:=bridgeCall("GET","/v1/public"+path+"?"+r.URL.RawQuery,nil,false)
  if err!=nil{bridgeError(w,502,"bridge_unavailable");return}
  bridgeJSON(w,status,data)
}
func bridgeProxyPage(w http.ResponseWriter,r *http.Request,path string){
  status,data,err:=bridgeCall("GET",path,nil,false)
  if err!=nil{http.Error(w,"Creator service unavailable",502);return}
  w.Header().Set("Content-Type","text/html; charset=utf-8")
  w.Header().Set("Cache-Control","no-store")
  w.Header().Set("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
  w.WriteHeader(status)
  w.Write(data)
}
func shopPage(w http.ResponseWriter,r *http.Request,_ httprouter.Params){
  bridgeProxyPage(w,r,"/shop")
}
func creatorStudioPage(w http.ResponseWriter,r *http.Request,_ httprouter.Params){
  session,ok:=bridgeSession(r)
  if !ok||!session.Admin {http.Redirect(w,r,"/signin?error=required",http.StatusSeeOther);return}
  bridgeProxyPage(w,r,"/creator-studio")
}
func creatorAdminProxy(w http.ResponseWriter,r *http.Request,ps httprouter.Params){
  session,ok:=bridgeSession(r)
  if !ok||!session.Admin {bridgeError(w,403,"creator_admin_required");return}
  if r.Method!="GET"&&r.Method!="POST" {bridgeError(w,405,"unsupported_method");return}
  if r.Method=="POST"&&(!bridgeSameOrigin(r)||!bridgeCheckCSRF(r,r.Header.Get("X-CSRF-Token"))){
    bridgeError(w,403,"csrf_rejected");return
  }
  path:=ps.ByName("path")
  if path==""||strings.Contains(path,".."){bridgeError(w,400,"invalid_path");return}
  payload,err:=io.ReadAll(io.LimitReader(r.Body,26*1024*1024))
  if err!=nil{bridgeError(w,400,"invalid_body");return}
  endpoint:="/v1/admin"+path
  if r.URL.RawQuery!=""{endpoint+="?"+r.URL.RawQuery}
  req,err:=http.NewRequest(r.Method,bridgeBase()+endpoint,bytes.NewReader(payload))
  if err!=nil{bridgeError(w,500,"invalid_request");return}
  req.Header.Set("Authorization","Bearer "+os.Getenv("BRIDGE_API_TOKEN"))
  req.Header.Set("Content-Type",r.Header.Get("Content-Type"))
  if v:=r.Header.Get("Content-Length");v!=""{req.Header.Set("X-File-Name",r.Header.Get("X-File-Name"))}
  response,err:=bridgeClient.Do(req)
  if err!=nil{bridgeError(w,502,"bridge_unavailable");return}
  defer response.Body.Close()
  w.Header().Set("Cache-Control","no-store")
  w.Header().Set("Content-Type",response.Header.Get("Content-Type"))
  w.Header().Set("X-Content-Type-Options","nosniff")
  w.WriteHeader(response.StatusCode)
  io.Copy(w,io.LimitReader(response.Body,26*1024*1024))
}
func bridgeCheckout(w http.ResponseWriter,r *http.Request,_ httprouter.Params){
  if !bridgeSameOrigin(r)||!bridgeCheckCSRF(r,r.FormValue("csrf")){http.Error(w,"Invalid form token",403);return}
  session,ok:=bridgeSession(r)
  if !ok||session.Admin{http.Redirect(w,r,"/signin?error=required",http.StatusSeeOther);return}
  creatorID,productID:=r.FormValue("creatorId"),r.FormValue("productId")
  if !bridgeSafeID(creatorID)||!bridgeSafeID(productID){http.Error(w,"Invalid product",400);return}
  request:=map[string]string{"provider":"heleket","creatorId":creatorID,"productId":productID,"patronId":session.PatronID,"tierId":"shop","amount":"1.00","currency":"USD"}
  if discount:=r.FormValue("discountCode");discount!="" {
    if len(discount)>64 {http.Error(w,"Invalid discount",400);return}
    request["discountCode"]=discount
  }
  body,_:=json.Marshal(request)
  status,data,err:=bridgeCall("POST","/v1/invoices",body,true)
  if err!=nil||status!=201{http.Error(w,"Payment checkout unavailable",502);return}
  var result struct {CheckoutURL string `json:"checkoutUrl"`}
  if json.Unmarshal(data,&result)!=nil{http.Error(w,"Invalid payment provider response",502);return}
  destination,err:=url.Parse(result.CheckoutURL)
  if err!=nil||destination.Scheme!="https"||destination.Host!="pay.heleket.com"{http.Error(w,"Invalid checkout URL",502);return}
  http.Redirect(w,r,destination.String(),http.StatusSeeOther)
}
func bridgeSafeID(value string)bool{
  if len(value)<1||len(value)>128{return false}
  for _,ch:=range value{
    if !(ch>='a'&&ch<='z'||ch>='A'&&ch<='Z'||ch>='0'&&ch<='9'||ch=='_'||ch=='-'){return false}
  }
  return true
}
func redeemGiftPage(w http.ResponseWriter,r *http.Request,ps httprouter.Params){
  code:=ps.ByName("code")
  if !bridgeSafeID(code){http.NotFound(w,r);return}
  status,data,err:=bridgeCall("GET","/v1/public/gifts/"+url.PathEscape(code),nil,false)
  if err!=nil {http.Error(w,"Gift service unavailable",502);return}
  if status!=200{http.Error(w,"Gift code unavailable or already claimed",404);return}
  var gift struct {
    CreatorID string `json:"creatorId"`
    TierID string `json:"tierId"`
    DurationDays int `json:"durationDays"`
    Remaining int `json:"remaining"`
  }
  if json.Unmarshal(data,&gift)!=nil{http.Error(w,"Invalid gift",502);return}
  session,loggedIn:=bridgeSession(r)
  loggedIn=loggedIn&&!session.Admin
  msg:=""
  if r.Method=="POST"{
    if !loggedIn{http.Redirect(w,r,"/signin?error=required",http.StatusSeeOther);return}
    if !bridgeSameOrigin(r)||!bridgeCheckCSRF(r,r.FormValue("csrf")){http.Error(w,"Invalid form token",403);return}
    body,_:=json.Marshal(map[string]string{"code":code,"patronId":session.PatronID})
    resultStatus,_,callErr:=bridgeCall("POST","/v1/admin/creator/gifts/redeem",body,true)
    if callErr!=nil{http.Error(w,"Gift service unavailable",502);return}
    if resultStatus==200{msg="Gift claimed! Your membership benefits are now active."}else{msg="This gift has already been redeemed or is no longer available."}
  }
  w.Header().Set("Content-Type","text/html; charset=utf-8")
  w.Header().Set("Cache-Control","no-store")
  w.Header().Set("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
  action:="/redeem/"+url.PathEscape(code)
  fmt.Fprintf(w,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redeem your gift - NekoSune</title><style>body{font-family:system-ui,sans-serif;background:radial-gradient(circle at top,#234c37,#0c130e 70%%);min-height:100vh;color:#f1fff4;display:grid;place-items:center;margin:0}main{padding:42px;max-width:500px;background:#15241bc9;border:1px solid #476752;border-radius:24px;box-shadow:0 12px 50px #0007}h1{font-size:38px;line-height:1.1}p{color:#c2d9c9;line-height:1.6}.tier{background:#25382b;padding:20px;border-radius:12px;margin:22px 0}button,.button{padding:14px 20px;background:#8bf2ac;color:#13231a;border:0;border-radius:10px;font-weight:bold;display:inline-block;text-decoration:none;cursor:pointer}</style></head><body><main><p>✦ NekoSune Creator Gifts</p><h1>A gift membership for you!</h1><p>Someone has invited you to receive creator membership benefits.</p><div class="tier"><strong>%s</strong><p>%d days of access · %d claims remaining</p><small>Creator: %s</small></div><p>%s</p>`,html.EscapeString(gift.TierID),gift.DurationDays,gift.Remaining,html.EscapeString(gift.CreatorID),html.EscapeString(msg))
  if msg=="" {
    if loggedIn {fmt.Fprintf(w,`<form method="POST" action="%s"><input type="hidden" name="csrf" value="%s"><button type="submit">Claim my gift</button></form>`,html.EscapeString(action),html.EscapeString(bridgeCSRF(r)))}
    else {fmt.Fprint(w,`<a class="button" href="/signin?error=required">Sign in to claim</a><p>After signing in, return to this gift link to claim it.</p>`)}
  }
  fmt.Fprint(w,`</main></body></html>`)
}

func bridgeWebhookProxy(w http.ResponseWriter,r *http.Request,_ httprouter.Params){
  // The bridge validates Heleket's signature; preserve request body byte-for-byte.
  payload,err:=io.ReadAll(io.LimitReader(r.Body,16385))
  if err!=nil||len(payload)>16384{bridgeError(w,413,"webhook_too_large");return}
  req,err:=http.NewRequest("POST",bridgeBase()+"/webhooks/heleket",bytes.NewReader(payload))
  if err!=nil{bridgeError(w,500,"invalid_webhook");return}
  req.Header.Set("Content-Type","application/json")
  response,err:=bridgeClient.Do(req)
  if err!=nil{bridgeError(w,502,"bridge_unavailable");return}
  defer response.Body.Close()
  data,_:=io.ReadAll(io.LimitReader(response.Body,16384))
  bridgeJSON(w,response.StatusCode,data)
}
func bridgeDownloadProxy(w http.ResponseWriter,r *http.Request,ps httprouter.Params){
  path:=ps.ByName("path")
  if len(path)<10||len(path)>4096||strings.Contains(path,".."){http.NotFound(w,r);return}
  req,err:=http.NewRequest("GET",bridgeBase()+"/v1/downloads"+path,nil)
  if err!=nil{http.NotFound(w,r);return}
  response,err:=bridgeClient.Do(req)
  if err!=nil{bridgeError(w,502,"bridge_unavailable");return}
  defer response.Body.Close()
  for _,header:=range []string{"Content-Type","Content-Disposition","Content-Length","Cache-Control","X-Content-Type-Options"}{
    if value:=response.Header.Get(header);value!=""{w.Header().Set(header,value)}
  }
  w.WriteHeader(response.StatusCode)
  io.Copy(w,io.LimitReader(response.Body,26*1024*1024))
}
