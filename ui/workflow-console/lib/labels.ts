// Centralised UI labels and tooltip descriptions shared across components.

export const PESTEL_LABEL: Record<string, string> = {
  P: "Political",
  E: "Economic",
  S: "Social",
  T: "Technological",
  En: "Environmental",
  L: "Legal",
};

export const PESTEL_DESC: Record<string, string> = {
  P: "Political — Politik, Regulierung, Geopolitik (z.B. EEG-Novelle, H2-Importstrategie)",
  E: "Economic — Märkte, Preise, Kapitalkosten (z.B. Merit-Order-Spread, CO2-Preis, LCOE)",
  S: "Social — Akzeptanz, Konsumverhalten, Gerechtigkeit (z.B. Bürgerenergie, Energiearmut)",
  T: "Technological — Innovationen, Effizienzsprünge, Patente (z.B. Solid State Battery, V2G)",
  En: "Environmental — Klimawandel, Ressourcen, physische Risiken (z.B. Dürre, kritische Rohstoffe)",
  L: "Legal — Rechtsprechung, Normen, Genehmigungen (z.B. RED III, Beschleunigungsgesetz)",
};

export const ANSOFF_LABEL: Record<number, string> = {
  1: "Sense of Threat",
  2: "Source Known",
  3: "Threat Characterized",
  4: "Response Known",
};

export const ANSOFF_DESC: Record<number, string> = {
  1: "Sense of Threat — vages Gefühl der Veränderung, kaum Belege",
  2: "Source Known — Quelle identifizierbar, Natur der Entwicklung unklar",
  3: "Threat Characterized — Entwicklung konkretisiert, strategische Implikationen offen",
  4: "Response Known — Reaktionsmöglichkeiten bekannt; Übergang vom Weak Signal zum Trend",
};

export const IMPACT_DESC: Record<string, string> = {
  HOCH: "Hohe Wirkung — kann Merit-Order verschieben oder Kapazitätsmärkte beeinflussen",
  MITTEL: "Mittlere Wirkung — operativ relevant, kein Strukturbruch",
  GERING: "Geringe Wirkung — Tagesgeschehen ohne systemische Folgen",
};

export const ZIELDREIECK_LABEL: Record<string, string> = {
  wirtschaftlichkeit: "Wirtschaftlichkeit",
  versorgungssicherheit: "Versorgungssicherheit",
  umweltvertraeglichkeit: "Umweltverträglichkeit",
};

export const ZIELDREIECK_DESC: Record<string, string> = {
  wirtschaftlichkeit: "Wirtschaftlichkeit — Wettbewerbsfähigkeit, Merit-Order, LCOE, Investitionsrenditen",
  versorgungssicherheit: "Versorgungssicherheit — Gesicherte Leistung, N-1, Diversifikation, Netzstabilität",
  umweltvertraeglichkeit: "Umweltverträglichkeit — Dekarbonisierung, Treibhausgasreduktion, Nachhaltigkeit",
};

export const VALIDATION_STATUS_DESC: Record<string, string> = {
  pending: "pending — Case wurde noch nicht vom Energy Expert validiert",
  awaiting_review: "awaiting_review — Expert konnte nicht eindeutig entscheiden; Human Review nötig",
  validated: "validated — Energy Expert hat den Case als domain-plausibel bestätigt",
  rejected: "rejected — Case wurde als domain-unplausibel oder irrelevant verworfen",
};

export const SIGNAL_DESC = {
  signal:
    "Signal — Assessment-Stage hat den Case als bedeutsamen Weak Signal eingestuft (relevant für strategische Foresight)",
  noise: "Noise — Case wurde als Tagesnachricht ohne strategische Wirkung klassifiziert",
};

export const EXPERT_VALID_DESC = {
  yes: "plausibel — Domain-Check bestanden: Case ist energiewirtschaftlich konsistent mit Merit-Order, Missing-Money, Netzphysik, Marktdesign",
  no: "unplausibel — Domain-Check fehlgeschlagen: Case widerspricht energiewirtschaftlichen Grundprinzipien",
};

export const TIME_HORIZON_DESC =
  "Geschätzter Zeithorizont der Auswirkung (z.B. <2J, 2-5J, >5J) — vom Energy-Expert-LLM beurteilt";
export const EXPERT_LABEL_DESC =
  "Energy Expert: LLM-gestützter Domain-Check pro Case (Merit-Order / Missing-Money / Kannibalisierung / Netzphysik) — siehe MAS_Foresight_Architektur §6.3";
export const CONFIDENCE_DESC =
  "Confidence: Wie sicher die Assessment-Stage in der Signal/Noise-Klassifikation ist (0-100%)";
export const HISTORY_PILL_DESC =
  "Diese Quelle wurde bereits in früheren Runs gefunden — Wiederkehrende URL deutet auf einen stabileren Trend hin als Einzelfundstücke";
