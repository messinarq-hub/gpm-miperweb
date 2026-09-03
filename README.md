# miper-server

Backend de registro y trazabilidad de controles para la app MIPER Nave 4/4.

Guarda usuarios (nombre + clave de 4 dígitos, hasheada con bcrypt) y un historial completo
de cada casilla marcada (No aplica / Cumple / No cumple) por tarea y riesgo,
con quién la marcó y cuándo.

**Las tablas de la base de datos se crean solas** la primera vez que arranca el
servidor — no hace falta pegar ningún script SQL a mano en ningún panel.

## Puesta en marcha

1. **Crear el proyecto de base de datos en Neon** (solo esto, nada de columnas ni SQL)
   - Ir a https://neon.tech y crear una cuenta gratuita.
   - Crear un proyecto nuevo (cualquier nombre, ej. `miper-nave-4-4`).
   - Copiar el "Connection string" (empieza con `postgresql://...`). Se necesita en el paso 3.
   - Eso es todo de este lado — las tablas las crea el servidor solo al arrancar.

2. **Subir este código a un repositorio de GitHub**
   - Crear un repositorio nuevo, ej. `miper-server`.
   - Subir estos archivos: `server.js`, `package.json`, `schema.sql`, `README.md`.
     (`schema.sql` queda solo como referencia/documentación; ya no hay que ejecutarlo a mano.)

3. **Desplegar en Render**
   - Ir a https://render.com y crear una cuenta gratuita (o iniciar sesión con GitHub).
   - "New" → "Web Service" → conectar el repositorio `miper-server`.
   - Runtime: Node. Build command: `npm install`. Start command: `npm start`.
   - En "Environment variables" agregar:
     - `DATABASE_URL` = el connection string de Neon del paso 1.
     - `JWT_SECRET` = cualquier texto largo y aleatorio (ej. generarlo en https://randomkeygen.com).
   - Crear el servicio. Al arrancar, el servidor crea las tablas automáticamente
     (se puede confirmar en los "Logs": aparece "Esquema verificado/creado correctamente.").
   - Render le va a dar una URL pública, algo como:
     `https://miper-server.onrender.com`

4. **Conectar la app MIPER a este servidor**
   - Pasar esa URL para actualizar el `index.html` de la app y que apunte ahí.

## Notas

- El plan gratuito de Render "duerme" el servidor tras un rato sin uso; la primera
  request después de estar dormido puede tardar unos 20-30 segundos en responder.
- Las contraseñas nunca se guardan en texto plano (se usa bcrypt).
- El historial de controles es de solo-agregado (append-only): cada marca queda
  guardada permanentemente, aunque el mismo inspector cambie de opinión después.
