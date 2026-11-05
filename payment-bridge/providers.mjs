// Provider roadmap based on NekoPay; "planned" means NOT wired for billing.
export const PROVIDERS = Object.freeze([
  {id:'stripe',name:'Stripe',kind:'fiat',status:'legacy',flow:'card'},
  {id:'paypal',name:'PayPal',kind:'fiat',status:'planned',flow:'redirect'},
  {id:'nowpayments',name:'NOWPayments',kind:'crypto',status:'planned',flow:'redirect'},
  {id:'zbd',name:'ZBD',kind:'lightning',status:'planned',flow:'invoice'},
  {id:'heleket',name:'Heleket',kind:'crypto',status:'beta',flow:'redirect'},
  ...['cryptomus','bitpay','coingate','oxapay','plisio'].map(id=>({id,name:id,kind:'crypto',status:'planned',flow:'redirect'})),
  ...['opennode','strike','alby','speed'].map(id=>({id,name:id,kind:'lightning',status:'planned',flow:'invoice'})),
  ...['checkoutcom','revolut'].map(id=>({id,name:id,kind:'fiat',status:'planned',flow:'redirect'})),
  ...['HIVE','HBD','STEEM','SBD','BLURT','TELOS','EOS','FIO','WAX','PIVX','FLS'].map(id=>({id:id.toLowerCase(),name:id,kind:'onchain',status:'planned',flow:'wallet'}))
]);
