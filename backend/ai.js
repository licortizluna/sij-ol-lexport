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

export async function generarEscrito({ expediente, tipoEscrito, instrucciones, fuentes }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no esta configurada");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const contexto = fuentes.map((f, i) => `FUENTE ${i + 1}: ${f.titulo}\nCLASE: ${f.clase}\n${f.texto.slice(0, 14000)}`).join("\n\n");
  const response = await client.responses.create({
    model: MODEL,
    input: [
      { role: "system", content: "Eres el motor juridico de SIJ-OL para litigio mexicano, principalmente Sonora. Redacta con tecnica forense, trazabilidad y explicabilidad. No inventes articulos, tesis, registros digitales, fechas ni hechos. Si una autoridad no esta verificada, identificala como pendiente de verificacion. Distingue hechos, inferencias y derecho. Relaciona cada prueba con los hechos y precisa que pretende acreditar. En escritos de tramite usa proemio corto. El corpus institucional gobierna el metodo; las fuentes recuperadas no sustituyen la verificacion de vigencia normativa." },
      { role: "user", content: `TIPO DE ESCRITO: ${tipoEscrito}\n\nEXPEDIENTE:\n${JSON.stringify(expediente, null, 2)}\n\nINSTRUCCIONES:\n${instrucciones}\n\nTESAURO RECUPERADO:\n${contexto || "Sin fuentes seleccionadas."}\n\nEntrega un borrador completo, seguido de CONTROL DE CALIDAD con datos faltantes, autoridades por verificar y fuentes empleadas.` }
    ]
  });
  return { texto: response.output_text, modelo: MODEL, responseId: response.id };
}
