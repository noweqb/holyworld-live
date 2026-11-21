const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),WebSocket=require('ws');
const root=__dirname,port=Number(process.env.PORT||3000),rooms=new Map(),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const holyworldApi='https://api.holyworld.me/v1/';
const cleanCode=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);
function createRoom(){let id;do{id=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(id));rooms.set(id,{createdAt:Date.now(),video:null,playing:false,position:0,changedAt:Date.now(),users:new Map()});return id}
function getRoom(id){return rooms.get(id)}
function state(r){return{video:r.video,playing:r.playing,position:r.position,changedAt:r.changedAt,users:[...r.users.values()]}}
function sendRoom(id,msg,skip){const r=rooms.get(id),data=JSON.stringify(msg);if(r)for(const c of r.users.keys())if(c!==skip&&c.readyState===WebSocket.OPEN)c.send(data)}
const notFound=(res,message='Страница не найдена')=>{res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><meta charset="utf-8"><title>404 — together</title><style>body{margin:0;background:#0b0b10;color:#f5f3f0;font:16px Arial;display:grid;place-items:center;height:100vh;text-align:center}h1{font-size:72px;margin:0;color:#d8ff62}p{color:#9895a4}a{color:#d8ff62}</style><main><h1>404</h1><h2>${message}</h2><p>Такой комнаты не существует или ссылка устарела.</p><a href="/">Вернуться на главную</a></main>`) };
async function proxyHolyworld(endpoint,res){
  const allowed=['health','servers','events','votings','coins-trades'];
  if(!allowed.includes(endpoint)){res.writeHead(404,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Unknown API endpoint'}))}
  try{
    const query=new URLSearchParams();
    if(endpoint==='events'||endpoint==='votings'){
      const serverName=new URL(res.req.url,'http://localhost').searchParams.get('server');
      if(serverName)query.set('server',serverName);
    }
    if(endpoint==='coins-trades'){
      const limit=new URL(res.req.url,'http://localhost').searchParams.get('limit');
      if(limit)query.set('limit',limit);
    }
    const response=await fetch(holyworldApi+endpoint+(query.size?'?'+query:'')).catch(()=>null);
    if(!response){res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'HolyWorld API недоступен'}))}
    const body=await response.text();res.writeHead(response.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(body);
  }catch(error){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Не удалось получить данные HolyWorld'}))}
}
const server=http.createServer((req,res)=>{const url=new URL(req.url,`http://${req.headers.host}`),p=decodeURIComponent(url.pathname);
  if(req.method==='POST'&&p==='/api/rooms'){const code=createRoom();res.writeHead(201,{'Content-Type':'application/json'});return res.end(JSON.stringify({code,url:`/room/${code}`}))}
  const holyworldMatch=p.match(/^\/api\/holyworld\/([^/]+)$/);if(req.method==='GET'&&holyworldMatch)return proxyHolyworld(holyworldMatch[1],Object.assign(res,{req}));
  if(p==='/'||['/servers','/events','/votings','/coins','/health'].includes(p)){const f=path.join(root,'dashboard.html');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(f).pipe(res)}
  const roomMatch=p.match(/^\/room\/([A-Za-z0-9]+)\/?$/);if(roomMatch){const code=cleanCode(roomMatch[1]);if(!/^[A-Z0-9]{6}$/.test(code)||!rooms.has(code))return notFound(res,'Комната не найдена');const f=path.join(root,'index.html');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(f).pipe(res)}
  return notFound(res)
});
const wss=new WebSocket.Server({server});wss.on('connection',(ws,req)=>{const u=new URL(req.url,`http://${req.headers.host}`),id=cleanCode(u.searchParams.get('room'));if(!/^[A-Z0-9]{6}$/.test(id)||!rooms.has(id))return ws.close(1008,'Room not found');const r=getRoom(id),user={id:crypto.randomUUID(),name:(u.searchParams.get('name')||'Гость').slice(0,24),color:u.searchParams.get('color')||'pink'};r.users.set(ws,user);ws.send(JSON.stringify({type:'state',state:state(r),self:user}));sendRoom(id,{type:'users',users:state(r).users},ws);ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}const now=Date.now();if(m.type==='video'){const kind=['youtube','external'].includes(m.kind)?m.kind:'file';r.video={url:String(m.url||'').slice(0,2000),kind,id:m.id||null};r.playing=false;r.position=0;r.changedAt=now;sendRoom(id,{type:'state',state:state(r)})}if(m.type==='sync'){r.playing=!!m.playing;r.position=Math.max(0,Number(m.position)||0);r.changedAt=now;sendRoom(id,{type:'sync',playing:r.playing,position:r.position,changedAt:now},ws)}if(m.type==='chat'&&String(m.text||'').trim())sendRoom(id,{type:'chat',user:r.users.get(ws),text:String(m.text).slice(0,500)})});ws.on('close',()=>{r.users.delete(ws);sendRoom(id,{type:'users',users:state(r).users})})});server.listen(port,()=>console.log(`together: http://localhost:${port}`));
