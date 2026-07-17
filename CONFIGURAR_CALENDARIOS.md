# SIJ-OL: Google Calendar y Recordatorios de iPhone

## Google Calendar

1. Cree un proyecto en Google Cloud y habilite **Google Calendar API**.
2. Configure la pantalla de consentimiento OAuth y cree credenciales **OAuth Client ID — Web application**.
3. Registre exactamente `http://127.0.0.1:3000/api/integraciones/google/callback` como URI de redirección.
4. Agregue a `.env.local`:

   ```text
   GOOGLE_CALENDAR_CLIENT_ID=SU_CLIENT_ID
   GOOGLE_CALENDAR_CLIENT_SECRET=SU_CLIENT_SECRET
   GOOGLE_TOKEN_ENCRYPTION_KEY=UNA_CADENA_ALEATORIA_DE_64_CARACTERES
   GOOGLE_CALENDAR_REDIRECT_URI=http://127.0.0.1:3000/api/integraciones/google/callback
   GOOGLE_CALENDAR_ID=primary
   GOOGLE_CALENDAR_PRIVACY=minima
   ```

   Genere la clave de cifrado con `openssl rand -hex 32`.

5. Reinicie SIJ-OL, abra **Tareas** y pulse **Conectar Google Calendar**.

Los tokens se cifran con AES-256-GCM dentro de la base local. `.env.local` y `.data/` no deben subirse a GitHub. Para acceso remoto HTTPS, cambie y registre la URI de redirección con el dominio remoto.

## Recordatorios de iPhone

1. En **Atajos**, cree uno llamado `SIJ-OL Recordatorio` y habilite que reciba **Texto**.
2. Agregue **Obtener diccionario de la entrada**.
3. Obtenga `titulo`, `fecha`, `hora` y `notas`.
4. Ejecute **Añadir nuevo recordatorio** con esos valores y seleccione la lista deseada.
5. En SIJ-OL pulse **Enviar a iPhone** sobre una tarea con fecha.

El Atajo se ejecuta en el dispositivo Apple; SIJ-OL no recibe acceso general a sus recordatorios.
