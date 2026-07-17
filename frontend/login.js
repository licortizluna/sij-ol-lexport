const form=document.querySelector("#login-form"),error=document.querySelector("#login-error");
try{const r=await fetch("/api/session");if(r.ok)location.replace("/");}catch{}
form.onsubmit=async event=>{event.preventDefault();error.textContent="Verificando…";const response=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:new FormData(form).get("password")})});const data=await response.json();if(!response.ok){error.textContent=data.error||"No fue posible iniciar sesión";return;}location.replace("/");};
