import type { ReactNode } from "react";
import Link from "next/link";

export default function HomePage(): ReactNode {
  return (
    <main>
      <h1>magyarsportonline.hu</h1>
      <p>
        Az oldal jelenleg fejlesztés alatt áll. A projekt egy AI-first,
        Story-alapú sporthír-platform, amelynek teljes architekturális terve a
        repository <code>docs/architecture/</code> könyvtárában található.
      </p>
      <p>
        A hírfolyam (publikus Story-oldalak) a fejlesztési roadmap
        9. fázisában kerül bevezetésre.
      </p>
      <p>
        <Link href="/impresszum">Impresszum</Link>
      </p>
    </main>
  );
}
