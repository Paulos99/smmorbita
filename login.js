import {API,getToken,setToken} from './auth.js';
if(getToken())location.replace('./');
const form=document.querySelector('#login-form'),error=document.querySelector('#login-error'),submit=document.querySelector('#submit'),password=document.querySelector('#password'),toggle=document.querySelector('#toggle-password');
toggle.addEventListener('click',()=>{const reveal=password.type==='password';password.type=reveal?'text':'password';toggle.textContent=reveal?'Скрыть':'Показать';toggle.setAttribute('aria-label',reveal?'Скрыть пароль':'Показать пароль');toggle.setAttribute('aria-pressed',String(reveal));});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(submit.disabled)return;error.textContent='';submit.disabled=true;submit.textContent='Проверяем пропуск…';
  try{const response=await fetch(API+'/api/login',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:form.login.value,password:password.value})});const data=await response.json();if(!response.ok){error.textContent=data.error || 'Не удалось войти. Попробуйте снова.';return;}if(!data.token){error.textContent='Не удалось войти. Попробуйте снова.';return;}setToken(data.token,data.expiresIn);password.value='';location.replace('./');}
  catch{error.textContent='Не удалось связаться со штабом. Проверьте соединение и попробуйте ещё раз.';}
  finally{submit.disabled=false;submit.replaceChildren(document.createTextNode('Открыть досье '));const arrow=document.createElement('span');arrow.textContent='→';arrow.setAttribute('aria-hidden','true');submit.append(arrow);}
});
