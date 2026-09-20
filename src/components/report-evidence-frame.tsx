"use client";

import Image from "next/image";
import { useState } from "react";

export function ReportEvidenceFrame({ src, label }: { src: string; label: string }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The representative evidence image is unavailable right now.</p>;
  return <Image src={src} alt={`Representative frame for ${label}`} width={960} height={540} unoptimized onError={() => setUnavailable(true)} className="max-h-72 w-full rounded-lg bg-slate-950 object-contain" />;
}
