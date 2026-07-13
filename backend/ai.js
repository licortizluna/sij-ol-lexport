import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.6";

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
