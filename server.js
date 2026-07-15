require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(session({ secret: process.env.SESSION_SECRET || 'dev-secret-change-me', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' }}));
app.use(express.static(path.join(__dirname, 'public')));

const initialCompanies = [
 ['ООО «ГУДВЕЙ»','7708168282','1037700198216'],['ООО «БЕНЕФИС»','7737548088','1097746138159'],['ООО «ЯГУАР»','5032199959','1155032002685'],['ООО «АЛЬТЕРНАТИВА»','7726435149','1187746609302'],['ООО «ГУДВЕЙ БИЗНЕС»','7727391293','1187746782244'],['ООО «ФАСТРЕНТ»','7734426130','1197746365376'],['ООО «ПРАЙМ»','7743306619','1197746420376'],['ООО «ВИП-ДИЗАЙН»','9705076157','1167746881500'],['ООО «ТЕМПО»','7734437340','1207700349240'],['ООО «БЕСПРОВОДНЫЕ РЕШЕНИЯ»','7736258202','5157746169455'],['ООО «ЛИДЕР ЛИЗИНГ»','9725026813','1197746739739'],['ООО «ФОРА»','7734444394','1217700316657'],['ООО «ШАШКА»','9715405234','1217700397067'],['ООО «ИМПОРТ ТРЕЙД»','9715417039','1227700201332'],['ООО «СЕВЕРТРАНС»','9721166961','1227700341329'],['ООО «ВЕКТОР»','3454006136','1203400007140'],['ООО «ВЕГАС»','9717121608','1227700629353'],['ООО «ПРОФИ»','9718204832','1227700639583'],['ООО «АВТОЛЮКС»','3455056806','1233400002901'],['ООО «АВТОРЕНТА»','3455056813','1233400002978'],['ООО «ЮГТРАНС»','7733412907','1237700381874'],['ООО «АВТОПРИМА»','3435145180','1233400005453'],['ООО «ЭКИПАЖ»','6122021489','1236100034213'],['ООО «ГРАНДВЕЙ»','0273949510','1240200009950'],['ООО «КАРО»','9714044899','1247700259795'],['ООО «КОЛОРИТ»','9713015430','1247700362227'],['ООО «ЦИФРОВЫЕ ТЕХНОЛОГИИ»','9713023649','1257700060210'],['ООО «ДРАЙВ»','9714070377','1257700067965'],['ООО «РЕСУРС»','7730335316','1257700090339'],['ООО «АВТО ПЛЮС»','9726095256','1257700114704'],['ООО «КАПИТАЛ»','9726095263','1257700114770'],['ООО «ТЕХИНВЕСТ»','9705248141','1257700427731'],['ООО «РОБСТРОЙ»','7735178346','1187746743326']
];
function emptyCompany(c,i){return {id:i+1,sort:i+1,name:c[0],full_name:c[0].replace('ООО','Общество с ограниченной ответственностью'),inn:c[1],ogrn:c[2],kpp:'',okpo:'',address:'',director:'',bank_account:'',bank_name:'',bik:'',corr_account:'',registering_authority:'',tax_authority:'',registration_date:'',main_activity:'',authorized_capital:'',founders:'',raw_json:null,updated_at:new Date().toISOString()}}
function initDb(){ if(!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE),{recursive:true}); if(!fs.existsSync(DB_FILE)){ const adminLogin=process.env.ADMIN_LOGIN||'admin', adminPassword=process.env.ADMIN_PASSWORD||'admin'; save({users:[{id:1,login:adminLogin,password_hash:bcrypt.hashSync(adminPassword,10),role:'admin',created_at:new Date().toISOString()}], companies: initialCompanies.map(emptyCompany), audit_log: []});}}
function load(){initDb(); return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));}
function save(db){fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));}
function requireAuth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'unauthorized'}); next(); }
function log(req, action, details=''){const db=load(); db.audit_log.unshift({id:Date.now(),user_login:req.session.user?.login||'anonymous',action,details,created_at:new Date().toISOString()}); db.audit_log=db.audit_log.slice(0,1000); save(db);}
function publicCompany(c){return c;}

function cleanText(s=''){
  return String(s).replace(/<[^>]*>/g,' ').replace(/&quot;/g,'"').replace(/&laquo;/g,'«').replace(/&raquo;/g,'»').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function extractFromCardContent(content, label){
  const re = new RegExp('<p[^>]*>\\s*<strong>\\s*'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*<\\/strong>\\s*([\\s\\S]*?)<\\/p>', 'i');
  const m = String(content||'').match(re);
  return m ? cleanText(m[1]) : '';
}
function importOldHtml(html){
  const cardsMatch = html.match(/const\s+cardsData\s*=\s*([\s\S]*?);\s*\/\/\s*Справочные данные/);
  const refMatch = html.match(/const\s+referenceData\s*=\s*([\s\S]*?);\s*let\s+currentSource/);
  if(!cardsMatch) throw new Error('Не найден блок cardsData в старом HTML');
  const sandbox = {};
  const code = `cardsData = ${cardsMatch[1]};\nreferenceData = ${refMatch ? refMatch[1] : '{}'};`;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, {timeout: 1000});
  const cardsData = sandbox.cardsData || {};
  const referenceData = sandbox.referenceData || {};
  const db = load();
  let updated = 0, created = 0;
  Object.entries(cardsData).forEach(([inn, card]) => {
    const ref = referenceData[inn] || {};
    let company = db.companies.find(x => x.inn === inn);
    if(!company){
      company = {id: Date.now()+created, sort: db.companies.length+1, inn};
      db.companies.push(company); created++;
    }
    company.name = card.name || company.name || extractFromCardContent(card.content,'Сокращенное наименование:') || inn;
    company.full_name = extractFromCardContent(card.content,'Полное наименование:') || company.full_name || company.name;
    company.kpp = extractFromCardContent(card.content,'КПП:') || company.kpp || '';
    company.ogrn = extractFromCardContent(card.content,'ОГРН:') || company.ogrn || '';
    company.okpo = extractFromCardContent(card.content,'ОКПО:') || company.okpo || '';
    company.address = extractFromCardContent(card.content,'Юридический адрес:') || company.address || '';
    company.director = extractFromCardContent(card.content,'Генеральный директор:') || company.director || '';
    company.bank_account = extractFromCardContent(card.content,'Расчетный счет:') || company.bank_account || '';
    company.bank_name = extractFromCardContent(card.content,'Банк:') || company.bank_name || '';
    company.bik = extractFromCardContent(card.content,'БИК:') || company.bik || '';
    company.corr_account = extractFromCardContent(card.content,'Корр. счет:') || company.corr_account || '';
    company.registering_authority = ref.registering_authority || company.registering_authority || '';
    company.tax_authority = ref.tax_authority || company.tax_authority || '';
    company.registration_date = ref.registration_date || company.registration_date || '';
    company.main_activity = ref.main_activity || company.main_activity || '';
    company.authorized_capital = ref.authorized_capital || company.authorized_capital || '';
    company.founders = ref.founders || company.founders || '';
    company.updated_at = new Date().toISOString();
    updated++;
  });
  save(db);
  return {updated, created};
}


app.post('/api/login',(req,res)=>{const db=load(); const u=db.users.find(x=>x.login===req.body.login); if(!u||!bcrypt.compareSync(req.body.password||'',u.password_hash)) return res.status(401).json({error:'Неверный логин или пароль'}); req.session.user={login:u.login,role:u.role}; res.json({ok:true,user:req.session.user});});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>res.json({user:req.session.user||null}));
app.get('/api/companies',requireAuth,(req,res)=>{const db=load(); res.json(db.companies.sort((a,b)=>(a.sort||999)-(b.sort||999)||a.name.localeCompare(b.name)).map(publicCompany));});
app.get('/api/company/:inn',requireAuth,(req,res)=>{const c=load().companies.find(x=>x.inn===req.params.inn); if(!c) return res.status(404).json({error:'Компания не найдена'}); log(req,'view_company',req.params.inn); res.json(publicCompany(c));});
app.post('/api/company',requireAuth,(req,res)=>{const db=load(); const c={id:Date.now(),...req.body,updated_at:new Date().toISOString()}; if(db.companies.some(x=>x.inn===c.inn)) return res.status(400).json({error:'ИНН уже есть'}); db.companies.push(c); save(db); log(req,'create_company',c.inn); res.json({ok:true});});
app.put('/api/company/:inn',requireAuth,(req,res)=>{const db=load(); const i=db.companies.findIndex(x=>x.inn===req.params.inn); if(i<0) return res.status(404).json({error:'Компания не найдена'}); db.companies[i]={...db.companies[i],...req.body,inn:req.params.inn,updated_at:new Date().toISOString()}; save(db); log(req,'update_company',req.params.inn); res.json({ok:true});});
app.post('/api/company/:inn/refresh-dadata', requireAuth, async (req,res)=>{
  try{
    const token = process.env.DADATA_TOKEN;
    if(!token) return res.status(400).json({error:'Не указан DADATA_TOKEN в .env'});
    const r = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party',{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':'Token '+token},
      body:JSON.stringify({query:req.params.inn, count:1})
    });
    const text = await r.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {raw:text}; }
    if(!r.ok) return res.status(r.status === 403 ? 400 : r.status).json({error:json.message||json.error||('DaData вернула HTTP '+r.status)});
    const item = json.suggestions && json.suggestions[0];
    if(!item) return res.status(404).json({error:'DaData не вернула компанию по этому ИНН'});
    const d = item.data || {};
    const db = load();
    const i = db.companies.findIndex(x=>x.inn===req.params.inn);
    if(i<0) return res.status(404).json({error:'Компания не найдена'});
    const prev = db.companies[i];
    db.companies[i] = {
      ...prev,
      name: d.name?.short_with_opf || item.value || prev.name,
      full_name: d.name?.full_with_opf || item.unrestricted_value || item.value || prev.full_name,
      kpp: d.kpp || prev.kpp || '',
      ogrn: d.ogrn || prev.ogrn || '',
      okpo: d.okpo || prev.okpo || '',
      address: d.address?.unrestricted_value || prev.address || '',
      director: d.management?.name || prev.director || '',
      main_activity: d.okved || prev.main_activity || '',
      authorized_capital: d.capital?.value ? String(d.capital.value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')+' руб.' : (prev.authorized_capital || ''),
      raw_json: item,
      updated_at: new Date().toISOString()
    };
    save(db);
    log(req,'refresh_dadata',req.params.inn);
    res.json({ok:true,company:db.companies[i]});
  }catch(e){
    console.error('DaData refresh error:', e);
    res.status(500).json({error:'Ошибка обновления DaData: '+e.message});
  }
});

app.post('/api/import-old-html', requireAuth, (req,res)=>{try{const html=req.body.html||''; if(!html) return res.status(400).json({error:'Файл пустой'}); const result=importOldHtml(html); log(req,'import_old_html',JSON.stringify(result)); res.json({ok:true,...result});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/company/:inn/fssp-link',requireAuth,(req,res)=>res.json({url:`https://fssp.gov.ru/iss/ip/?is%5Bvariant%5D=5&is%5Binn%5D=${encodeURIComponent(req.params.inn)}`}));
app.get('/api/company/:inn/fns-link',requireAuth,(req,res)=>{const c=load().companies.find(x=>x.inn===req.params.inn); const q=c?.ogrn||req.params.inn; res.json({url:`https://pb.nalog.ru/search-ext.html#mode=search-ul-ext&queryUlExt=${encodeURIComponent(q)}`});});
app.get('/api/audit',requireAuth,(req,res)=>res.json(load().audit_log.slice(0,200)));

initDb();
app.listen(PORT,()=>console.log(`Company Hub: http://localhost:${PORT}`));
