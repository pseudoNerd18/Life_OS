/**
 * The slice of Google Identity Services this app uses. GIS ships no types of
 * its own, and `@types/google.accounts` pulls in the entire surface for three
 * calls.
 */
interface GsiIdConfiguration {
  client_id: string;
  callback: (response: { credential?: string; select_by?: string }) => void;
  nonce?: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
}

interface GsiButtonConfiguration {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "small" | "medium" | "large";
  shape?: "rectangular" | "pill" | "circle" | "square";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  logo_alignment?: "left" | "center";
  width?: number;
}

declare global {
  interface GsiTokenResponse {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  }

  interface GsiTokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: GsiTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
    prompt?: "" | "none" | "consent" | "select_account";
  }

  interface GsiTokenClient {
    requestAccessToken: (overrides?: { prompt?: string }) => void;
  }

  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: GsiIdConfiguration) => void;
          renderButton: (parent: HTMLElement, options: GsiButtonConfiguration) => void;
          disableAutoSelect: () => void;
        };
        oauth2?: {
          initTokenClient: (config: GsiTokenClientConfig) => GsiTokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

export {};
