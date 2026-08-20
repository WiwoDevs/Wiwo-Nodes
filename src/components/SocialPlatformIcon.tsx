import {
  FacebookLogo,
  GoogleLogo,
  InstagramLogo,
  LinkedinLogo,
  TiktokLogo,
  XLogo,
  YoutubeLogo,
  type IconProps,
} from "@phosphor-icons/react";
import type { InteractionKind, SocialPlatform } from "../types";

export const SOCIAL_PLATFORM_OPTIONS: ReadonlyArray<{
  id: SocialPlatform;
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

const ICONS = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  x: XLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
  linkedin: LinkedinLogo,
  google_business: GoogleLogo,
} satisfies Record<SocialPlatform, typeof InstagramLogo>;

export function platformLabel(platform: SocialPlatform): string {
  return SOCIAL_PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
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
