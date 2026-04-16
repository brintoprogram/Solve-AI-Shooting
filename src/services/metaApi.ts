import type { MetaApiTemplate, MetaApiPhoneInfo } from "@/types/shooting";

const BASE_URL = "https://graph.facebook.com/v21.0";

async function metaFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err?.error?.message ?? `Meta API error ${res.status}: ${res.statusText}`
    );
  }

  return res.json();
}

export async function getPhoneNumberInfo(
  phoneNumberId: string,
  accessToken: string
): Promise<MetaApiPhoneInfo> {
  return metaFetch<MetaApiPhoneInfo>(
    `/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
    accessToken
  );
}

export async function listTemplates(
  wabaId: string,
  accessToken: string
): Promise<MetaApiTemplate[]> {
  interface TemplatesResponse {
    data: MetaApiTemplate[];
    paging?: { cursors?: { after?: string }; next?: string };
  }

  const all: MetaApiTemplate[] = [];
  let url = `/${wabaId}/message_templates?limit=100&fields=id,name,language,category,status,components,quality_score`;

  while (url) {
    const res = await metaFetch<TemplatesResponse>(url, accessToken);
    all.push(...res.data);
    url = res.paging?.next
      ? res.paging.next.replace(`${BASE_URL}`, "")
      : "";
  }

  return all;
}

export interface SendMessagePayload {
  to: string;
  templateName: string;
  language: string;
  components: Array<{
    type: string;
    parameters: Array<{ type: string; text?: string; image?: { link: string } }>;
  }>;
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  payload: SendMessagePayload
): Promise<{ messages: Array<{ id: string }> }> {
  return metaFetch(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: payload.to,
        type: "template",
        template: {
          name: payload.templateName,
          language: { code: payload.language },
          components: payload.components,
        },
      }),
    }
  );
}
