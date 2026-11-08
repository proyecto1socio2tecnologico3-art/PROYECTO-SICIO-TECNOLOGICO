# Plataforma Educativa del Liceo Bolivariano Rafael María Urrecheaga

Documentación del servicio **desplegado en Render**. Describe cómo acceder a la plataforma y cómo se configura y opera en producción; no incluye instrucciones para ejecutar la copia local del proyecto.

## Acceso al servicio

Abre la dirección pública asignada al servicio `pequenos-ingenieros` en Render. La URL exacta se consulta en el panel de Render y no está fijada en este repositorio. El endpoint `/healthz` permite comprobar si el servicio responde.

Al entrar, la plataforma solicita el código general de acceso. Después, cada persona utiliza su cuenta de estudiante o de administrador. El código general es compartido y no sustituye las credenciales individuales.

## Funciones y roles

- **Estudiantes:** pueden consultar los contenidos disponibles para su grado, completar cuestionarios y revisar su progreso.
- **Administrador Principal (`admin_master`):** administra los contenidos de aprendizaje, revisa las solicitudes de acceso de administradores, gestiona las cuentas administrativas y sus asignaciones, consulta el progreso y puede actualizar el código general de acceso.
- **Administradores asignados:** trabajan con los campos y materias que tienen asignados y pueden consultar el progreso asociado a ellos.

Los administradores pueden cambiar su contraseña desde la plataforma. Las solicitudes de cuenta administrativa quedan pendientes de aprobación; la contraseña de una solicitud no se almacena como texto legible.

## Contenidos y límites

La biblioteca organiza los contenidos en campos avanzados, campos generales y campos de grado con materias. Los contenidos pueden incluir artículos, cuestionarios y enlaces web. No se admiten archivos PDF.

Límites aplicados por el servicio:

| Elemento | Límite |
|---|---:|
| Campos avanzados | 20 |
| Campos generales | 20 |
| Campos de grado | 5 |
| Materias por campo de grado | 12 |
| Campos y materias con contenido, en total | 100 |
| Artículos por campo o materia | 3 |
| Palabras por artículo | 5.000 |
| Cuestionarios por campo o materia | 20 |
| Caracteres por pregunta | 300 |
| Caracteres por opción de respuesta | 80 |
| Enlaces web por campo o materia | 20 |
| Tamaño máximo de una solicitud al servidor | 64 MiB |

No hay un máximo definido de cuentas de estudiantes o administradores.

## Despliegue y servicios

El servicio web está configurado en [`render.yaml`](./render.yaml):

- **Alojamiento:** Render Web Service, plan gratuito configurado en el Blueprint.
- **Runtime:** Python 3.12.8.
- **Inicio:** Render instala las dependencias de [`requirements.txt`](./requirements.txt) y ejecuta `python server.py`.
- **Base de datos de producción:** TiDB Cloud compatible con MySQL; la conexión usa TLS.
- **Comprobación de salud:** `GET /healthz`.

Render proporciona la dirección y el puerto del servicio. Los archivos del disco de Render son efímeros: la información de usuarios y contenidos se conserva en TiDB, no en el disco del servicio. Los servicios gratuitos de Render pueden suspenderse por inactividad, por lo que el primer acceso posterior a una pausa puede tardar. No debe suponerse disponibilidad permanente ni utilizarse como servicio crítico sin revisar las condiciones del proveedor.

## Configuración de producción

Las siguientes variables deben configurarse en Render. Las credenciales y los códigos deben guardarse como secretos, nunca en el repositorio:

| Variable | Uso |
|---|---|
| `TIDB_HOST` | Host del clúster TiDB |
| `TIDB_PORT` | Puerto de TiDB; el Blueprint propone `4000` |
| `TIDB_USER` | Usuario de base de datos con privilegios limitados a la base de la aplicación |
| `TIDB_PASSWORD` | Contraseña de ese usuario |
| `TIDB_DATABASE` | Base de datos de la aplicación, por ejemplo `pequenos_ingenieros` |
| `SUPERADMIN_PASSWORD` | Contraseña inicial del Administrador Principal, necesaria al inicializar una base nueva |
| `PLATFORM_ACCESS_CODE` | Código general de acceso inicial; debe tener entre 6 y 128 caracteres |

`SUPERADMIN_PASSWORD` inicializa la cuenta principal cuando todavía no hay una contraseña guardada en la base. No se debe cambiar esperando que reemplace automáticamente una contraseña existente. El código general puede actualizarse desde el panel del Administrador Principal; una vez guardado, se conserva en TiDB.

Para poner en servicio una instalación nueva, crea la base de datos TiDB y configura las variables requeridas en Render antes de desplegar. Después del despliegue, comprueba `/healthz`, valida el acceso con el código general y prueba el inicio de sesión, el registro de estudiantes y los permisos administrativos.

### Migración inicial

El script [`migrar_tiidb.py`](./migrar_tiidb.py) sirve únicamente para una migración inicial hacia una TiDB vacía. La migración disponible copia el hash del Administrador Principal, el hash del código general y los campos de grado con sus materias (hasta cinco campos). **No migra** campos avanzados o generales, cuentas de estudiantes, administradores asignados, solicitudes pendientes ni progreso. Se niega a sobrescribir una base TiDB que ya contenga datos. Planifica cualquier migración antes de que el servicio reciba información real y verifica explícitamente qué datos no se trasladarán.

## Datos y seguridad

La aplicación usa estas tablas en TiDB:

| Tabla | Información |
|---|---|
| `students` | Cuentas de estudiantes y datos asociados, incluido el progreso |
| `admins` | Cuentas de administradores y asignaciones |
| `admin_requests` | Solicitudes de acceso administrativo |
| `learning_fields` | Campos, materias, artículos, cuestionarios, enlaces y contenido |
| `account_credentials` | Sales criptográficas y hashes de credenciales de cuentas |
| `app_metadata` | Metadatos de inicialización y hashes de acceso administrativo |

Las contraseñas se guardan mediante hashes, no como texto plano. La sesión de usuario utiliza una cookie `HttpOnly`, `SameSite=Strict` y, en producción, `Secure`. El servidor valida los permisos para consultar o modificar datos; la interfaz por sí sola no concede acceso.

Recomendaciones para quienes administran el servicio:

- Limita los permisos del usuario TiDB a la base de la aplicación y conserva sus credenciales en las variables secretas de Render.
- Usa un código general robusto y compártelo solo con personas autorizadas. Al ser compartido, no reemplaza la autenticación individual ni identifica a cada usuario.
- Revisa las copias de seguridad y las opciones de recuperación de TiDB; no uses el disco de Render como respaldo.
- Tras un despliegue, verifica `/healthz` y consulta los registros de Render si el servicio no inicia o no puede conectarse a TiDB.

## Componentes del despliegue

- [`server.py`](./server.py): servidor HTTP, autenticación, permisos, API y persistencia.
- [`app.js`](./app.js), [`index.html`](./index.html) y [`styles.css`](./styles.css): interfaz web.
- [`render.yaml`](./render.yaml): configuración del servicio en Render.
- [`requirements.txt`](./requirements.txt): dependencias de producción.
- [`migrar_tiidb.py`](./migrar_tiidb.py): utilidad de migración inicial descrita arriba.
