export type DocumentType =
  | "invoice"
  | "INVOICE"
  | "TAX_INVOICE"
  | "NON_GST_BILL"
  | "quotation"
  | "QUOTATION"
  | "purchase_order"
  | "PURCHASE_ORDER"
  | "purchase_invoice"
  | "PURCHASE_INVOICE"
  | "payment_receipt"
  | "PAYMENT_RECEIPT"
  | "supplier_payment"
  | "expense"
  | "EXPENSE";

export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  pan: string;
  state?: string;
  logoUrl?: string;
  footerText?: string;
  termsConditions?: string;
  invoicePrefix?: string;
  quotationPrefix?: string;
  purchasePrefix?: string;
  bankDetails?: string;
}
