import ExcelJS from "exceljs";
import type { SacFlowRepository } from "./repository-contract.js";
import type { InteractionFilters } from "./types.js";

const HEADER_FILL = "FF1E293B";
const ACCENT_FILL = "FF2563EB";

function styleHeader(row: ExcelJS.Row, fill = HEADER_FILL): void {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { vertical: "middle" };
  });
}

function safeExcelText(value: string | undefined): string {
  const text = value ?? "";
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function buildInteractionsWorkbook(
  repository: SacFlowRepository,
  filters: InteractionFilters = {},
): Promise<Buffer> {
  const [store, stats, interactions] = await Promise.all([
    repository.snapshot(),
    repository.stats(filters),
    repository.listInteractions(filters),
  ]);
  const brands = new Map(store.brands.map((brand) => [brand.id, brand]));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SAC Flow";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Interacciones de SAC provenientes de Metricool";

  const interactionsSheet = workbook.addWorksheet("Interacciones", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  interactionsSheet.columns = [
    { header: "ID", key: "id", width: 23 },
    { header: "Fecha", key: "createdAt", width: 21 },
    { header: "Marca", key: "brand", width: 22 },
    { header: "Cuenta", key: "account", width: 22 },
    { header: "Canal", key: "channel", width: 13 },
    { header: "Tipo", key: "type", width: 12 },
    { header: "Dirección", key: "direction", width: 12 },
    { header: "Cliente", key: "customer", width: 22 },
    { header: "Usuario", key: "handle", width: 20 },
    { header: "Mensaje", key: "text", width: 55 },
    { header: "Categoría", key: "category", width: 18 },
    { header: "Sentimiento", key: "sentiment", width: 15 },
    { header: "Confianza", key: "confidence", width: 12 },
    { header: "Estado", key: "status", width: 14 },
    { header: "Responsable", key: "assignee", width: 22 },
    { header: "Notas internas", key: "internalNoteCount", width: 15 },
    { header: "Respuesta", key: "response", width: 55 },
    { header: "Respondido", key: "respondedAt", width: 21 },
    { header: "Fuente", key: "source", width: 12 },
    { header: "Riesgo SAC", key: "automationRisk", width: 14 },
    { header: "Ruta SAC", key: "automationRoute", width: 18 },
    { header: "Conocimiento", key: "knowledgeStatus", width: 20 },
    { header: "Bloqueos / motivos", key: "automationReasons", width: 34 },
  ];
  styleHeader(interactionsSheet.getRow(1));

  for (const interaction of [...interactions].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )) {
    const brand = brands.get(interaction.brandId);
    interactionsSheet.addRow({
      id: interaction.id,
      createdAt: new Date(interaction.createdAt),
      brand: safeExcelText(brand?.name || interaction.brandId),
      account: safeExcelText(brand?.account.handle || interaction.accountId),
      channel: interaction.channel,
      type: interaction.type,
      direction: interaction.direction,
      customer: safeExcelText(interaction.customerName),
      handle: safeExcelText(interaction.customerHandle),
      text: safeExcelText(interaction.text),
      category: interaction.category,
      sentiment: interaction.sentiment,
      confidence: interaction.confidence,
      automationRisk: interaction.automation?.risk ?? "sin evaluar",
      automationRoute: interaction.automation?.effectiveRoute ?? "sin evaluar",
      knowledgeStatus: interaction.automation?.knowledge.status ?? "sin evaluar",
      automationReasons: safeExcelText(interaction.automation?.reasonCodes.join(", ")),
      status: interaction.status,
      assignee: safeExcelText(interaction.assignedTo?.displayName),
      internalNoteCount: interaction.internalNotes?.length ?? 0,
      response: safeExcelText(interaction.responseText),
      respondedAt: interaction.respondedAt ? new Date(interaction.respondedAt) : "",
      source: interaction.source,
    });
  }
  interactionsSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  interactionsSheet.getColumn("respondedAt").numFmt = "yyyy-mm-dd hh:mm";
  interactionsSheet.getColumn("confidence").numFmt = "0%";
  interactionsSheet.autoFilter = { from: "A1", to: "W1" };
  interactionsSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });

  const summarySheet = workbook.addWorksheet("Resumen", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  summarySheet.columns = [
    { header: "Métrica", key: "metric", width: 32 },
    { header: "Valor", key: "value", width: 18 },
    { header: "DMs", key: "dms", width: 12 },
    { header: "Comentarios", key: "comments", width: 15 },
    { header: "Reseñas", key: "reviews", width: 12 },
    { header: "Pendientes", key: "pending", width: 14 },
    { header: "Respondidos", key: "replied", width: 14 },
  ];
  styleHeader(summarySheet.getRow(1), ACCENT_FILL);
  summarySheet.addRow({ metric: "Total de interacciones", value: stats.total });
  summarySheet.addRow({ metric: "Mensajes directos", value: stats.dms });
  summarySheet.addRow({ metric: "Comentarios", value: stats.comments });
  summarySheet.addRow({ metric: "Reseñas", value: stats.reviews });
  summarySheet.addRow({ metric: "Pendientes", value: stats.pending });
  summarySheet.addRow({ metric: "Respondidos", value: stats.replied });
  summarySheet.addRow({ metric: "Escalados", value: stats.escalated });
  summarySheet.addRow({ metric: "Respuestas automatizadas", value: stats.automatedResponses });
  summarySheet.addRow({ metric: "Evaluadas por protocolo SAC", value: stats.automationEvaluated });
  summarySheet.addRow({ metric: "Candidatas a auto-respuesta", value: stats.autoReplyCandidates });
  summarySheet.addRow({ metric: "Revisión humana obligatoria", value: stats.humanReviewRequired });
  summarySheet.addRow({ metric: "Bloqueadas por conocimiento", value: stats.knowledgeBlocked });
  const rateRow = summarySheet.addRow({ metric: "Tasa de respuesta", value: stats.responseRate / 100 });
  rateRow.getCell("value").numFmt = "0.0%";
  summarySheet.addRow({
    metric: "Tiempo medio de respuesta (min)",
    value: stats.averageResponseMinutes ?? "Sin datos",
  });
  summarySheet.addRow({});
  const brandHeader = summarySheet.addRow({
    metric: "Marca",
    value: "Total",
    dms: "DMs",
    comments: "Comentarios",
    reviews: "Reseñas",
    pending: "Pendientes",
    replied: "Respondidos",
  });
  styleHeader(brandHeader);
  for (const brand of stats.byBrand) {
    summarySheet.addRow({
      metric: safeExcelText(brand.brandName),
      value: brand.total,
      dms: brand.dms,
      comments: brand.comments,
      reviews: brand.reviews,
      pending: brand.pending,
      replied: brand.replied,
    });
  }

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
