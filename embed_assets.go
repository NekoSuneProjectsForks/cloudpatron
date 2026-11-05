package main

import (
  "embed"
  "io/fs"
  "os"
  "sort"
)

// Assets compiled into the new Go Docker binary, replacing the legacy go-bindata build.
//go:embed static templates email
var siteAssets embed.FS

func Asset(name string) ([]byte,error) {return siteAssets.ReadFile(name)}
func AssetInfo(name string) (os.FileInfo,error) {return fs.Stat(siteAssets,name)}
func AssetNames() []string {
  paths:=[]string{}
  fs.WalkDir(siteAssets,".",func(path string,d fs.DirEntry,err error)error{
    if err==nil && !d.IsDir(){paths=append(paths,path)}
    return nil
  })
  sort.Strings(paths)
  return paths
}
