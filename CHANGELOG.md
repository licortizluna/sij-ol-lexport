# 0.27.0

- Integración OAuth con Google Calendar y sincronización sin duplicados por tarea.
- Tokens de Google cifrados localmente con AES-256-GCM.
- Privacidad mínima por defecto y avisos de 24 horas y 60 minutos.
- Puente a Recordatorios de iPhone mediante el Atajo local `SIJ-OL Recordatorio`.
- Estado, error y última sincronización visibles y persistentes por tarea.

# 0.26.0

- Permite clasificar cada expediente como Activo, Suspendido, Concluido, Archivado o Provisional.
- Incorpora el selector tanto en Captura y edición como dentro de la ficha individual.
- Excluye suspendidos, concluidos y archivados de la consulta automática diaria, conservando su historial completo.
- Muestra la situación con distintivo visual en la cartera y dentro de los buscadores predictivos.
- Agrega contadores de expedientes suspendidos y concluidos al panel principal.
- Registra cada cambio de situación en Trazabilidad y exige confirmación humana desde la ficha.

# 0.25.0

- Recupera el control de etapas como pestaña propia dentro de la ficha de cada expediente.
- Muestra porcentaje de avance, etapa en curso, pendientes, completadas, fechas objetivo y notas.
- Al completar una etapa activa automáticamente la siguiente y sincroniza la tarea correspondiente.
- Migra el estado procesal y la próxima etapa ya capturados al nuevo historial sin perder información.
- Sustituye los selectores en cascada por combobox predictivos en Generador IA, Agenda, Tareas, Documentos y Listas de acuerdos.
- Permite localizar expedientes por número, actor, demandado o juzgado y conserva internamente la vinculación por ID.

# 0.24.0

- Detecta duplicados seguros por número normalizado y órgano judicial, evitando unir asuntos de juzgados distintos.
- Presenta una vista previa y permite elegir los grupos antes de ejecutar cualquier cambio.
- Conserva como principal el registro con documentos y, en igualdad, el que tenga mayor información procesal.
- Migra documentos, acuerdos, tareas, agenda, análisis y borradores al expediente principal.
- Archiva el duplicado en lugar de eliminarlo y registra toda la consolidación en Trazabilidad.
- Oculta de la cartera ordinaria los duplicados archivados sin afectar respaldos ni historial.

# 0.23.0

- Permite editar una tarea existente sin perder su origen, estado ni trazabilidad.
- Incorpora búsqueda inmediata por título, expediente, partes o notas.
- Permite reabrir tareas cumplidas desde la vista Todas y conserva la sincronización con Agenda.
- Muestra el total de tareas filtradas y mantiene visibles los controles con listas extensas.
- Refuerza el panel lateral con filas de altura propia para evitar que Chrome oculte el formulario.

# 0.22.1

- Corrige el estiramiento vertical del formulario Nueva tarea provocado por una lista extensa.
- Mantiene todos los controles del editor compactos y visibles en la parte superior.
- Fija el editor durante el desplazamiento y deja la lista de tareas utilizar el ancho restante.

# 0.22.0

- Importa 145 tareas proporcionadas por el usuario a la base nativa de SIJ-OL, sin conexión ni dependencia externa.
- Conserva 42 pendientes y 103 realizadas, con fecha, prioridad, datos de referencia y estado original normalizado.
- Vincula tareas por número de expediente o folio interno cuando la coincidencia es segura; conserva las demás para revisión sin crear expedientes falsos.
- La importación es idempotente: se ejecuta antes de iniciar y no duplica registros en arranques posteriores.
- Las tareas realizadas muestran su fecha de cumplimiento y las no vinculadas conservan la referencia del expediente de origen.

# 0.21.3

- Elimina el contenedor interno que Chrome ocultaba después de terminar la consulta.
- Renderiza cada publicación como elemento directo e independiente dentro de su juzgado y secretaría.
- Fuerza visibilidad de Asunto, Partes, Síntesis y Acción, y elimina el desplazamiento interno del concentrado.

# 0.21.2

- Durante la ejecución actualiza únicamente progreso y conteos; presenta la tabla definitiva una sola vez al concluir.
- Evita estructuralmente que las filas de Asunto, Partes y Síntesis se muevan o desaparezcan por repintados parciales.
- Desactiva la caché de archivos del frontend y versiona JavaScript y estilos para garantizar que Chrome cargue la corrección instalada.

# 0.21.1

- Estabiliza el concentrado mientras la consulta está en ejecución: los movimientos encontrados se acumulan y no desaparecen en actualizaciones posteriores.
- Impide respuestas de sondeo superpuestas y descarta respuestas atrasadas de otra consulta.
- Evita filas duplicadas en el concentrado cuando un expediente tiene más de un registro de detalle para la misma ejecución.
- Conserva el orden inicial del órgano y la secretaría durante todo el progreso.

# 0.21.0

- Presenta los resultados diarios con la estructura de la lista oficial del STJ: órgano judicial, secretaría, asunto, partes y síntesis.
- Agrupa las coincidencias por órgano judicial para identificar de inmediato a qué juzgado pertenece cada expediente.
- Conserva por separado las partes y la secretaría que publica el STJ, incluso cuando el acuerdo ya estaba incorporado.
- Amplía el CSV diario con órgano, secretaría, partes y síntesis del acuerdo.

# 0.20.0

- La consulta diaria y su CSV muestran exclusivamente expedientes con publicaciones encontradas ese día.
- Homologa abreviaturas, errores de captura y variantes de juzgados contra el identificador y nombre oficial del STJ Sonora.
- Conserva persistentemente la homologación para consultas posteriores.
- Distingue órganos federales o ajenos al STJ Sonora como fuente no aplicable, sin forzar coincidencias falsas.
- Reduce la velocidad de consulta, conserva la sesión pública y reintenta respuestas 403/429 temporales del portal.

# 0.19.0

- Corrige el botón Abrir expediente observado en el video IMG_1047: ya no aterriza en el concentrado general.
- Incorpora una ficha individual con Datos generales, Histórico de listas, Documentos y Tareas.
- Abrir desde la cartera muestra Datos generales; abrir desde el concentrado entra directamente al Histórico.
- Añade regreso al punto de origen y limita visualmente el concentrado para evitar recorridos extensos.
- Permite consultar tareas filtradas por expediente dentro de su ficha.

# 0.18.0

- La primera consulta construye una sola vez el histórico completo; las posteriores consultan únicamente la fecha actual de Sonora.
- La consulta diaria se agrupa por órgano jurisdiccional y distribuye cada publicación al expediente correspondiente.
- Conserva el texto íntegro publicado de la actuación dentro del histórico y en la exportación CSV.
- Recupera Tareas con semáforo, avisos de vencidas, hoy y mañana, y sincronización con Agenda.
- La próxima etapa procesal y su fecha objetivo generan o actualizan una tarea automáticamente.

# 0.17.0

- Consulta automática asunto por asunto para toda la cartera activa.
- Concentrado general descargable con resultados, movimientos nuevos y asuntos por revisar.
- Histórico de listas incorporado como pestaña dentro de cada expediente.
- Relación automática del juzgado capturado con el catálogo oficial y deduplicación SHA-256.
- Indicador de avance y opción para detener la consulta masiva.

# 0.16.0

- Recupera el módulo de consulta de listas de acuerdos con acceso a la fuente oficial del Poder Judicial de Sonora.
- Incorpora PDF, DOCX, TXT, MD o texto pegado al histórico de cada expediente con SHA-256 y trazabilidad.
- Añade cronología, última actuación, resumen procesal por IA y advertencias para revisión humana.
- Exporta el histórico por expediente en CSV.

# 0.15.0

- Elimina la captura y extracción del domicilio particular de la parte actora.
- El proemio utiliza exclusivamente el domicilio procesal institucional precargado.
- El control de calidad ya no considera el domicilio particular como dato faltante.

# 0.14.0

- Respaldos cifrados AES-256-GCM con SQLite consistente, documentos y manifiesto SHA-256.
- Verificación de contraseña, autenticidad, rutas y huellas desde la interfaz.
- Restauración fuera de línea con confirmación explícita y respaldo preventivo.
- Trazabilidad atribuida al usuario autenticado.
- Límite independiente de hasta 2 GB para verificar respaldos.
