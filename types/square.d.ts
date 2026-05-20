// Minimal type surface for Square's Web Payments SDK. We load the SDK via a
// <Script> tag (not the npm package) so these declarations exist purely to
// give us autocomplete + type-safety in the small set of methods we touch.
// Square's full type definitions live in @square/web-sdk; we'd pull that in
// only if our usage grows beyond what's declared here.

declare global {
  interface Window {
    Square?: {
      payments: (applicationId: string, locationId: string) => SquarePayments;
    };
  }

  interface SquarePayments {
    card: (options?: SquareCardOptions) => Promise<SquareCard>;
  }

  interface SquareCard {
    attach: (selector: string | HTMLElement) => Promise<void>;
    detach: () => Promise<void>;
    tokenize: () => Promise<SquareTokenizeResult>;
    destroy: () => Promise<boolean>;
  }

  interface SquareCardOptions {
    // Style object lets us match the Midnight Precision palette used by the
    // rest of the booking flow. Square enforces a strict allowlist of
    // selectors AND values — unknown keys, comma-separated font stacks,
    // and arbitrary CSS selectors all throw at init time. Stick to single
    // font names and the exact selectors below.
    style?: {
      input?: {
        color?: string;
        fontSize?: string;
        // Single font name only (no fallback stack).
        fontFamily?: string;
        backgroundColor?: string;
      };
      "input.is-error"?: { color?: string };
      "input::placeholder"?: { color?: string };
      ".input-container"?: {
        borderColor?: string;
        borderRadius?: string;
      };
      ".input-container.is-focus"?: { borderColor?: string };
      ".input-container.is-error"?: { borderColor?: string };
    };
  }

  interface SquareTokenizeResult {
    status: "OK" | "Error";
    token?: string;
    errors?: Array<{ message?: string; type?: string; field?: string }>;
  }
}

export {};
