export type LedgerClient = { id: string; surname: string; givenName: string; phone: string; comment: string };
export type LedgerObject = { id: string; clientId: string; clientName: string; address: string; workType: string; priceRub: string | null; recordedExpenseRub: string | null; preliminaryProfitRub: string | null; status: string; comment: string };
export type LedgerExpense = { id: string; date: string; objectId: string; clientId: string; description: string; amountRub: string; category: string; comment: string };
export type LedgerSelection = { clientId?: string; objectId?: string };
export type LedgerStatus = { configured: boolean; spreadsheetUrl: string; message: string };
export type LedgerCommand = { kind: "message"; message: string; requestId: string; selection?: LedgerSelection } | { kind: "select"; clientId?: string; objectId?: string; requestId: string };
export type LedgerReply = { message: string; selection: LedgerSelection; clients?: LedgerClient[]; objects?: LedgerObject[]; expenses?: LedgerExpense[]; currentObject?: LedgerObject; needsChoice?: "client" | "object"; applied?: boolean; operationId?: string };
