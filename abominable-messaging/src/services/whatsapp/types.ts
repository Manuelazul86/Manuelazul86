/** Provider-agnostic contract, so a second channel can be added later. */

export interface SendTextRequest {
  to: string; // E.164
  body: string;
}

export interface SendTemplateRequest {
  to: string; // E.164
  templateName: string;
  languageCode: string;
  variables: Record<string, string>;
}

export type SendRequest =
  | ({ kind: "text" } & SendTextRequest)
  | ({ kind: "template" } & SendTemplateRequest);

export interface SendSuccess {
  ok: true;
  providerMessageId: string;
  mock: boolean;
}

export interface SendFailure {
  ok: false;
  errorCode: string;
  errorMessage: string;
  /** Whether the pipeline should schedule another attempt. */
  retryable: boolean;
  mock: boolean;
}

export type SendResult = SendSuccess | SendFailure;
