# Acceso remoto seguro a SIJ-OL

SIJ-OL no debe publicarse mediante reenvío de puertos del módem. Esta versión escucha únicamente en `127.0.0.1` y utiliza Tailscale Serve como túnel HTTPS privado.

## 1. Crear la contraseña de SIJ-OL

Desde la carpeta del proyecto, ejecutar:

```bash
npm run configurar:acceso
```

La contraseña debe tener al menos 14 caracteres. Se guarda únicamente un hash `scrypt`; el secreto de sesión y el hash quedan en `.env.security`, excluido de GitHub.

## 2. Instalar y conectar Tailscale

Instalar Tailscale en el iMac y en cada equipo autorizado. Todos deben iniciar sesión en la misma red privada de Tailscale. No activar **Funnel**, pues Funnel publica el servicio en Internet.

## 3. Arrancar SIJ-OL

```bash
npm start
```

Debe mostrar `127.0.0.1:3000 · acceso autenticado`.

## 4. Publicarlo solo dentro de la red privada

En otra ventana de Terminal del iMac:

```bash
tailscale serve --bg localhost:3000
tailscale serve status
```

El segundo comando mostrará una dirección HTTPS terminada en `.ts.net`. Esa será la dirección que se abrirá desde los demás equipos que tengan Tailscale autorizado.

## 5. Revocar el acceso remoto

```bash
tailscale serve reset
```

También puede detener SIJ-OL. Para cambiar la contraseña, vuelva a ejecutar `npm run configurar:acceso`; todas las sesiones anteriores dejarán de ser válidas al reiniciar.

## Controles incluidos

- Contraseña derivada con `scrypt`; nunca se almacena en texto legible.
- Cookie de sesión `HttpOnly`, `SameSite=Strict` y `Secure` al usar HTTPS.
- Sesión máxima configurable, limitada a 12 horas.
- Bloqueo de 15 minutos después de cinco intentos fallidos por origen.
- Token CSRF para altas, modificaciones, cargas, aprobaciones y cancelaciones.
- Encabezados contra carga en marcos, detección MIME y fuga de referencia.
- El servidor se enlaza solo a la interfaz local.
- El modo remoto se niega a iniciar si faltan secretos seguros.

## Importante

El iMac debe permanecer encendido, conectado a Internet y sin suspensión. Los equipos remotos deben estar autorizados en Tailscale. Mantenga además respaldos cifrados de `.data/` y `uploads/`; el acceso remoto no reemplaza el respaldo.
