import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.6";

export async function estructurarExpediente(narrativa) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no esta configurada");
  if (!String(narrativa || "").trim()) throw new Error("Describa el expediente o pegue los datos disponibles");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const fields = ["numero", "tipo_juicio", "actor", "demandado", "juzgado", "distrito_judicial", "ciudad", "estado_procesal", "notas"];
  const properties = Object.fromEntries(fields.map(field => [field, { type: "string" }]));
  const response = await client.responses.create({
    model: MODEL,
    input: [{
      role: "user",
      content: `Extrae únicamente los datos expresamente contenidos en la siguiente narración para crear un expediente jurídico. No inventes ni completes por intuición. Conserva literalmente nombres, números y denominaciones de órganos. Usa cadena vacía cuando falte un dato. En notas identifica de manera breve los datos faltantes.\n\n${narrativa}`
    }],
    text: {
      format: {
        type: "json_schema",
        name: "expediente_sijol",
        strict: true,
        schema: { type: "object", properties, required: fields, additionalProperties: false }
      }
    }
  });
  return JSON.parse(response.output_text);
}

export async function extraerTextoDocumento({ buffer, filename, mimeType = "application/pdf" }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("El PDF es escaneado y requiere OPENAI_API_KEY para OCR");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: MODEL,
    input: [{
      role: "user",
      content: [
        { type: "input_file", filename, file_data: `data:${mimeType};base64,${buffer.toString("base64")}` },
        { type: "input_text", text: "Transcribe íntegramente este documento jurídico escaneado. Conserva encabezados, nombres, fechas, números de expediente, considerandos, puntos resolutivos y citas tal como aparecen. No resumas, no corrijas y no inventes texto ilegible; marca cada fragmento ilegible como [ILEGIBLE]. Devuelve únicamente la transcripción." }
      ]
    }]
  });
  return response.output_text?.trim() || "";
}

export async function extraerDatosForenses(anexos) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no esta configurada");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const campos = ["nombre_actor", "numero_credito", "escritura_numero", "volumen", "fecha_escritura", "notario", "descripcion_inmueble", "clave_catastral", "folio_real", "inscripcion", "libro", "seccion", "fecha_registro", "ultimo_pago", "otros_datos"];
  const properties = Object.fromEntries(campos.map(campo => [campo, { type: "string" }]));
  const contenido = anexos.map((anexo, i) => `DOCUMENTO ${i + 1}: ${anexo.nombre}\n${anexo.texto.slice(0, 30000)}`).join("\n\n");
  const response = await client.responses.create({
    model: MODEL,
    input: [{ role: "user", content: `Extrae datos literales de los documentos jurídicos siguientes. No infieras ni inventes. Conserva nombres, números, medidas, colindancias y datos registrales completos. Usa cadena vacía si un dato no aparece. En descripcion_inmueble conserva íntegramente ubicación, lote, manzana, superficie, medidas y colindancias.\n\n${contenido}` }],
    text: { format: { type: "json_schema", name: "datos_forenses", strict: true, schema: { type: "object", properties, required: campos, additionalProperties: false } } }
  });
  return JSON.parse(response.output_text);
}

export async function generarEscrito({ expediente, tipoEscrito, instrucciones, fuentes, datosForenses = {}, anexos = [], signal }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no esta configurada");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const contexto = fuentes.map((f, i) => `FUENTE ${i + 1}: ${f.titulo}\nCLASE: ${f.clase}\n${f.texto.slice(0, 14000)}`).join("\n\n");
  const documentos = anexos.map((a, i) => `ANEXO ${i + 1}: ${a.nombre}\n${a.texto.slice(0, 18000)}`).join("\n\n");
  const response = await client.responses.create({
    model: MODEL,
    input: [
      { role: "system", content: "Eres el motor juridico de SIJ-OL para litigio mexicano, principalmente Sonora. El campo documento_final debe contener EXCLUSIVAMENTE el escrito listo para presentar: sin explicaciones, advertencias, control de calidad, fuentes internas ni justificaciones metodológicas. En demandas iniciales inserta en el proemio, con nombres y datos completos, únicamente el domicilio procesal, correo, abogados patronos y personas autorizadas recibidos en proemio_institucional; nunca digas que vienen del sistema o de una plantilla. No solicites, menciones ni marques como faltante el domicilio particular o personal de la parte actora: para oír y recibir notificaciones debe utilizarse el domicilio procesal institucional. Extrae de los anexos, cuando estén expresos: número de crédito, escritura, fecha, volumen, notario, descripción íntegra del inmueble, clave catastral, folio real, inscripción, libro, sección y fecha registral. No inventes datos. Los demás faltantes indispensables se marcan [DATO PENDIENTE]. El campo control_calidad es privado y separado: enumera faltantes, riesgos, normas por verificar, anexos leídos y fuentes empleadas, pero tampoco debe considerar faltante el domicilio particular de la parte. Nunca mezcles control interno en documento_final." },
      { role: "user", content: `TIPO DE ESCRITO: ${tipoEscrito}\n\nEXPEDIENTE:\n${JSON.stringify(expediente, null, 2)}\n\nDATOS FORENSES Y AUTORIZACIONES:\n${JSON.stringify(datosForenses, null, 2)}\n\nINSTRUCCIONES:\n${instrucciones}\n\nDOCUMENTOS ANEXOS A EXTRAER:\n${documentos || "Sin anexos."}\n\nTESAURO RECUPERADO:\n${contexto || "Sin fuentes seleccionadas."}` }
    ],
    text: { format: { type: "json_schema", name: "escrito_sijol", strict: true, schema: { type:"object", properties: { documento_final:{type:"string"}, control_calidad:{type:"string"} }, required:["documento_final","control_calidad"], additionalProperties:false } } }
  }, { signal });
  const salida = JSON.parse(response.output_text);
  return { texto: salida.documento_final, controlCalidad: salida.control_calidad, modelo: MODEL, responseId: response.id };
}

export async function resumirHistorialAcuerdos(expediente, acuerdos) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no esta configurada");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const historial = acuerdos.map((a,i)=>`PUBLICACIÓN ${i+1}\nFecha: ${a.fecha_publicacion||"Sin fecha"}\nÓrgano: ${a.organo||expediente.juzgado||"Sin dato"}\n${a.texto.slice(0,12000)}`).join("\n\n");
  const response = await client.responses.create({model:MODEL,input:[{role:"system",content:"Analiza exclusivamente publicaciones de listas de acuerdos mexicanas. Produce un resumen operativo del estado del expediente, en orden cronológico, distinguiendo hechos expresos de inferencias. Señala última actuación publicada, posibles plazos o acciones que requieren revisión humana y datos faltantes. No inventes fechas, términos ni efectos jurídicos."},{role:"user",content:`EXPEDIENTE:\n${JSON.stringify(expediente,null,2)}\n\nHISTORIAL DE LISTAS:\n${historial}`} ]});
  return { texto:response.output_text?.trim()||"", modelo:MODEL, responseId:response.id };
}
