#!/usr/bin/env python3
# Builds the static shell (no course materials, no catalog) into /workspace/smm-pages.
import os,shutil,re
YC="/workspace/smm-yc/app"; ARC="/workspace/ex/ОТ КОНТЕНТА ДО КЛИЕНТА/smm-school-archive"; OUT="/workspace/smm-pages"
API="https://bba2iub2khhe4eg3fagq.containers.yandexcloud.net"
for n in os.listdir(OUT):
    if n!='.git': p=os.path.join(OUT,n); shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
shutil.copytree(ARC+"/public/assets",OUT+"/assets")
for f in ["favicon.svg","login.css"]: shutil.copy(YC+"/public/"+f,OUT)
shutil.copy(YC+"/archive-src/styles.css",OUT)
csp=f'<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: https://storage.yandexcloud.net; font-src \'self\'; worker-src \'self\' blob:; connect-src \'self\' https://api.smmorbita.ru {API} https://storage.yandexcloud.net; media-src \'self\' blob: https://storage.yandexcloud.net; frame-src \'self\' https://storage.yandexcloud.net https://www.youtube-nocookie.com https://vk.com https://vkvideo.ru https://rutube.ru https://player.vimeo.com https://www.loom.com https://drive.google.com https://kinescope.io https://ok.ru https://t.me https://dzen.ru; object-src \'none\'; base-uri \'self\'; form-action \'self\'"><meta name="referrer" content="strict-origin-when-cross-origin">'
common=f"""export const API='{API}';
export const getToken=()=>{{try{{const t=JSON.parse(localStorage.getItem('smm-auth')||'null');if(t&&t.exp>Date.now()&&/^[a-f0-9]{{64}}$/.test(t.token))return t.token;}}catch{{}}return null;}};
export const setToken=(token,sec)=>localStorage.setItem('smm-auth',JSON.stringify({{token,exp:Date.now()+(sec||28800)*1000-60000}}));
export const clearToken=()=>{{try{{localStorage.removeItem('smm-auth');localStorage.removeItem('smm-role');}}catch{{}}}};
"""
open(OUT+"/auth.js","w").write(common)
# app page
html=open(YC+"/archive-src/index.html",encoding="utf-8").read().replace("<head>","<head>"+csp,1)
html=re.sub(r"assets/(accepted|school|sfera|skill|target)\.png",r"assets/\1.webp",html)
html=re.sub(r'<img (?![^>]*loading=)([^>]*src="\./assets/(?:skill|target|sfera)\.webp")',r'<img loading="lazy" \1',html)
open(OUT+"/index.html","w",encoding="utf-8").write(html)
js=open(YC+"/archive-src/app.js",encoding="utf-8").read()
pre="""import {API,getToken,clearToken} from './auth.js';
if(!getToken()){location.replace('./login.html');throw new Error('auth');}
"""
js=pre+js
js=js.replace("""window.fetch = async (...args) => { const response = await originalFetch(...args); if (response.status === 401) location.replace('/login'); return response; };""",
"""window.fetch = async (input, init = {}) => { let url=String(input); if (url.startsWith('/api/')) { url=API+url; const h=new Headers(init.headers||{}); h.set('X-School-Token',getToken()); try{const r=localStorage.getItem('smm-role');if(r)h.set('X-School-Role',r);}catch{} init={...init,headers:h,credentials:'omit'}; } const response = await originalFetch(url, init); if (response.status === 401 && url.startsWith(API)) { clearToken(); location.replace('./login.html'); } return response; };""",1)
assert "API+url" in js
js=js.replace("if(r.ok)location.replace('/login')","clearToken();if(r.ok||true)location.replace('./login.html')",1)
js=js.replace("if(res.ok)location.reload();","if(res.ok){try{localStorage.setItem('smm-role',sel.value);}catch{}location.reload();}",1)
js=js.replace("const response = await fetch('./lessons.json');","const response = await fetch('/api/lessons');",1)
js=js.replace("return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null;",
 "return (url.origin === location.origin || url.origin === 'https://storage.yandexcloud.net') && ['http:', 'https:'].includes(url.protocol) ? url.href : null;",1)
for s in ["'/api/lessons'","smm-role',sel.value","storage.yandexcloud.net'","clearToken();if"]: assert s in js, s
js=js.replace("controls.append(navigation,tools);root.append(stage,controls);container.append(root);this.go(0);","controls.append(navigation,tools);root.append(stage,controls);container.append(root);this.go(0);this.preload();",1)
js=js.replace("  go(page){if(this.dead","  preload(){const urls=this.resource.preview.urls.map(safeUrl);this.cache=[];let i=1;const next=()=>{if(this.dead||i>=urls.length)return;const im=new Image();im.decoding='async';this.cache.push(im);im.onload=im.onerror=next;im.src=urls[i++];};for(let k=0;k<4;k++)next();}\n  go(page){if(this.dead",1)
js=js.replace("isEvalSupported:false}","isEvalSupported:false,disableRange:true,disableStream:true,disableAutoFetch:false}",1)
for s in ["this.preload();","preload()","disableRange:true"]: assert s in js, s
js=re.sub(r"assets/(accepted|school|sfera|skill|target)\.png",r"assets/\1.webp",js)
# refresh presigned links: reload page if catalog older than 50 min when tab becomes visible
js+="\nconst __loaded=Date.now();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-__loaded>50*60000)location.reload();});\n"
open(OUT+"/app.js","w",encoding="utf-8").write(js)
# login page
lh=open(YC+"/login.html",encoding="utf-8").read().replace("<head>","<head>"+csp,1)
lh=lh.replace('href="/','href="./').replace('src="/','src="./').replace('action="/api/login"','action="#"')
lh=re.sub(r'<script[^>]*src="[^"]*login\.js"[^>]*></script>','<script type="module" src="./login.js"></script>',lh)
assert './login.js' in lh
lh=re.sub(r"assets/(accepted|school|sfera|skill|target)\.png",r"assets/\1.webp",lh)
open(OUT+"/login.html","w",encoding="utf-8").write(lh)
lj=open(YC+"/public/login.js",encoding="utf-8").read()
lj="import {API,getToken,setToken} from './auth.js';\nif(getToken())location.replace('./');\n"+lj
lj=lj.replace("fetch('/api/login',{method:'POST',credentials:'same-origin',","fetch(API+'/api/login',{method:'POST',credentials:'omit',",1)
lj=lj.replace("password.value='';location.replace('/');","if(!data.token){error.textContent='Не удалось войти. Попробуйте снова.';return;}setToken(data.token,data.expiresIn);password.value='';location.replace('./');",1)
assert "setToken(data.token" in lj and "API+'/api/login'" in lj
open(OUT+"/login.js","w",encoding="utf-8").write(lj)
shutil.copy(OUT+"/login.html",OUT+"/404.html")
open(OUT+"/CNAME","w").write("smmorbita.ru\n"); open(OUT+"/.nojekyll","w").close()
for name in ["admin.html", "admin.css", "admin.js", "docx.js", "previews.js", "htmlpack.js"]:
    src = os.path.join(YC, "public", name)
    if os.path.exists(src): shutil.copy(src, OUT)
open(OUT+"/README.md","w").write("# smmorbita.ru — static shell\n\nStatic front for the SMM school archive. No course materials or catalog here: after login the page calls the school API (Yandex Cloud), which checks the token and returns the student's own lessons with short-lived links.\nThe teacher cabinet is admin.html (teachers only; the API checks the role).\n")
from PIL import Image
for n in ["accepted","school","sfera","skill","target"]:
    p=OUT+"/assets/"+n+".png"; im=Image.open(p).convert("RGBA"); 
    if im.width>800: im=im.resize((800,round(im.height*800/im.width)),Image.LANCZOS)
    im.save(OUT+"/assets/"+n+".webp","WEBP",quality=82,method=5); os.remove(p)
for f in ["styles.css","login.css"]:
    c=open(OUT+"/"+f).read(); c=re.sub(r"(accepted|school|sfera|skill|target)\.png",r"\1.webp",c); open(OUT+"/"+f,"w").write(c)
print("ok")
