// Type declarations for the Moneris Checkout JS library that we load via a
// <Script> tag from gatewayt.moneris.com / gateway.moneris.com. There's no
// official @types package — these types cover only the surface we actually
// use in components/moneris-payment-form.tsx.

export type MonerisCallbackName =
  | "page_loaded"
  | "cancel_transaction"
  | "payment_complete"
  | "payment_receipt"
  | "error_event";

export type MonerisCallbackResponse = {
  // Moneris stamps every callback with the ticket the iframe was started
  // with, plus a response_code on completion/receipt events. Other fields
  // vary by callback — typed loosely so we can read what we need at runtime.
  ticket?: string;
  response_code?: string;
  [key: string]: unknown;
};

export interface MonerisCheckout {
  setMode(mode: "qa" | "prod"): void;
  setCheckoutDiv(divId: string): void;
  setCallback(
    name: MonerisCallbackName,
    cb: (response: MonerisCallbackResponse | string) => void,
  ): void;
  startCheckout(ticket: string): void;
  closeCheckout(): void;
}

declare global {
  interface Window {
    // The library exposes the constructor under the lowercase name.
    monerisCheckout: new () => MonerisCheckout;
  }
}

export {};
