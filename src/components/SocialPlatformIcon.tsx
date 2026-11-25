import {
  FacebookLogo,
  GoogleLogo,
  InstagramLogo,
  LinkedinLogo,
  TiktokLogo,
  WhatsappLogo,
  XLogo,
  YoutubeLogo,
  type IconProps,
} from "@phosphor-icons/react";
import type { InteractionKind, MetricoolPlatform, SocialPlatform } from "../types";

/** Redes que se conectan por Metricool (las que se marcan en una cuenta). */
export const SOCIAL_PLATFORM_OPTIONS: ReadonlyArray<{
  id: MetricoolPlatform;
  label: string;
  inbox: string;
}> = [
  { id: "instagram", label: "Instagram", inbox: "Mensajes y comentarios" },
  { id: "facebook", label: "Facebook", inbox: "Mensajes y comentarios" },
  { id: "x", label: "X", inbox: "Mensajes" },
  { id: "tiktok", label: "TikTok", inbox: "Comentarios" },
  { id: "youtube", label: "YouTube", inbox: "Comentarios" },
  { id: "linkedin", label: "LinkedIn", inbox: "Comentarios y menciones" },
  { id: "google_business", label: "Google Business", inbox: "Reseñas" },
];

/** Todas las redes de la bandeja: las de Metricool más WhatsApp (números vinculados). */
export const ALL_PLATFORM_OPTIONS: ReadonlyArray<{
  id: SocialPlatform;
  label: string;
  inbox: string;
}> = [
  ...SOCIAL_PLATFORM_OPTIONS,
  { id: "whatsapp", label: "WhatsApp", inbox: "Mensajes" },
];

const ICONS = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  x: XLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
  linkedin: LinkedinLogo,
  google_business: GoogleLogo,
  whatsapp: WhatsappLogo,
} satisfies Record<SocialPlatform, typeof InstagramLogo>;

export function platformLabel(platform: SocialPlatform): string {
  return ALL_PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
}

export function interactionKindLabel(kind: InteractionKind): string {
  if (kind === "dm") return "Mensaje directo";
  if (kind === "review") return "Reseña";
  return "Comentario";
}

export function SocialPlatformIcon({ platform, ...props }: IconProps & { platform: SocialPlatform }) {
  const Icon = ICONS[platform];
  return <Icon {...props} />;
}
