import {API,getToken,setToken} from './auth.js?v=20261023d';
import {registerShell,armInstallHint} from './install.js?v=20261023d';
registerShell();
if(getToken())location.replace('./');
else armInstallHint();
const form=document.querySelector('#login-form'),error=document.querySelector('#login-error'),submit=document.querySelector('#submit'),password=document.querySelector('#password'),toggle=document.querySelector('#toggle-password');
const reduceMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function rejectLogin(message){
  error.textContent=message;
  const card=document.querySelector('.login-card');
  if(!card||reduceMotion)return;
  card.classList.remove('is-shaking');
  void card.offsetWidth;
  card.classList.add('is-shaking');
}
toggle.addEventListener('click',()=>{const reveal=password.type==='password';password.type=reveal?'text':'password';toggle.textContent=reveal?'Скрыть':'Показать';toggle.setAttribute('aria-label',reveal?'Скрыть пароль':'Показать пароль');toggle.setAttribute('aria-pressed',String(reveal));});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(submit.disabled)return;error.textContent='';submit.disabled=true;submit.textContent='Проверяем пропуск…';
  try{const body=JSON.stringify({login:form.login.value,password:password.value});let response,last;for(let i=0;i<3&&!response;i++){if(i)submit.textContent='Повторяем попытку…';const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),35000);try{response=await fetch(API+'/api/login',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body,signal:ctl.signal});}catch(e){last=e;console.warn('login attempt',i+1,'failed',e);if(i<2)await new Promise(r=>setTimeout(r,1000*(i+1)));}finally{clearTimeout(t);}}if(!response)throw last||new Error('network');const data=await response.json();if(!response.ok){rejectLogin(data.error || 'Не удалось войти. Попробуйте снова.');return;}if(!data.token){rejectLogin('Не удалось войти. Попробуйте снова.');return;}setToken(data.token,data.expiresIn);password.value='';location.replace('./');}
  catch(e){console.error('Login failed:',e);rejectLogin('Сервер недоступен из вашей сети. Попробуйте подключиться через Wi-Fi или отключить VPN/блокировщик и войти ещё раз.');}
  finally{submit.disabled=false;submit.replaceChildren(document.createTextNode('Открыть досье '));const arrow=document.createElement('span');arrow.textContent='→';arrow.setAttribute('aria-hidden','true');submit.append(arrow);}
});
const forgotOpen=document.querySelector('#forgot-open'),forgotForm=document.querySelector('#forgot-form'),forgotNote=document.querySelector('#forgot-note'),forgotSubmit=document.querySelector('#forgot-submit');
const forgotSent='Заявка отправлена. Если такая учётка есть, преподаватель её увидит.';
forgotOpen?.addEventListener('click',()=>{const open=forgotForm.hidden;forgotForm.hidden=!open;forgotOpen.setAttribute('aria-expanded',String(open));if(open)forgotForm.login?.focus();});
forgotForm?.addEventListener('submit',async event=>{
  event.preventDefault();if(!forgotSubmit||forgotSubmit.disabled)return;forgotNote.textContent='';forgotSubmit.disabled=true;
  try{const response=await fetch(API+'/api/password-reset',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:forgotForm.login.value,contact:forgotForm.contact.value})});const data=await response.json().catch(()=>({}));if(response.status===429){forgotNote.textContent=data.error||'Слишком много заявок. Попробуйте позже.';return;}if(!response.ok){forgotNote.textContent=data.error||'Не удалось отправить заявку. Попробуйте ещё раз.';return;}forgotNote.textContent=forgotSent;forgotForm.login.value='';forgotForm.contact.value='';}
  catch{forgotNote.textContent='Сервер недоступен из вашей сети. Попробуйте подключиться через Wi-Fi или отключить VPN/блокировщик и отправить заявку ещё раз.';}
  finally{forgotSubmit.disabled=false;}
});
