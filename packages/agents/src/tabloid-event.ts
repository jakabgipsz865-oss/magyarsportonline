import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { TabloidEventDescriptor, TabloidEventIdentity } from "@magyarsportonline/shared";

export interface EventArticle {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  sourceUrl: string;
  publishedAt: Date | null;
  ingestedAt: Date;
}
export interface EventRepository {
  withTabloidLock<T>(id: string, work: () => Promise<T>): Promise<T>;
  getTabloidEvent(rawId: string): Promise<TabloidEventIdentity | null>;
  listTabloidEvents(baseKey: string, at: Date): Promise<TabloidEventIdentity[]>;
  saveTabloidEvent(rawId: string, event: TabloidEventIdentity): Promise<void>;
}
export const EVENT_WINDOW_MS = 48 * 3600_000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const normalizeEventText = (text: string) =>
  load(text, null, false)
    .text()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Explicit aliases only. A surname/city alone must not invent a football identity.
const entities: Array<[string, RegExp]> = [
  ["person:gianluigi-donnarumma", /\bdonnarumma\b/],
  ["person:edson-alvarez", /\bedson alvarez\b/],
  ["person:sorba-thomas", /\bsorba thomas\b|\bhull (?:city )?thomas\b/],
  ["person:cristiano-ronaldo", /\bcristiano ronaldo\b|\bcr7\b/],
  ["person:lionel-messi", /\blionel messi\b|\bleo messi\b/],
  ["person:david-beckham", /\bdavid beckham\b/],
  ["person:michael-olise", /\bmichael olise\b|\bolise\b/],
  ["person:manu-kone", /\bmanu kone\b/],
  ["team:manchester-united", /\bmanchester united\b|\bman utd\b/],
  ["team:arsenal", /\barsenal\b/],
  ["person:gary-lineker", /\bgary lineker\b/],
  ["person:darren-fletcher", /\bdarren fletcher\b/],
  ["person:michael-carrick", /\bmichael carrick\b/],
  ["person:elliot-anderson", /\belliot anderson\b/],
  ["person:mauricio-pochettino", /\b(?:mauricio )?pochettino\b/],
  ["person:mikel-arteta", /\bmikel arteta\b/],
  ["person:amanda-staveley", /\bamanda staveley\b/],
  ["person:ismail-kartal", /\bismail kartal\b/],
  ["person:todd-boehly", /\btodd boehly\b/],
  ["team:bayern-munich", /\b(?:fc )?bayern(?: munich| munchen| monaco)?\b/],
  ["team:chelsea", /\bchelsea\b/],
  ["team:tottenham", /\btottenham\b|\bspurs\b/],
  ["team:west-ham", /\bwest ham(?: united)?\b/],
  ["team:fenerbahce", /\bfenerbahce\b/],
];
// Ticket sanctions require both a ticket subject and an enforcement action.
// No club, source, headline or incident-specific number is part of the rule.
const ticketSubject =
  /\b(season tickets?|tickets?|ticketing|abonos?|entradas?|abbonamenti|biglietti|dauerkarten|eintrittskarten)\b/;
const ticketEnforcement =
  /\b(revok\w*|strip\w*|remov\w*|bans?|banned|cancel\w*|crackdown|touting|sanction\w*|retir\w*|revoc\w*|anulad\w*|sancion\w*|annull\w*|sperr\w*|entzog\w*|entzug)\b/;
const eventTypes: Array<[string, RegExp]> = [
  ["kidnapping-allegation", /\b(kidnap\w*|secuestro|entfuhr\w*)\b/],
  ["robbery", /\b(robber\w*|robbed|raub\w*|uberfall|robo|atraco|asalto armado|rapina\w*)\b/],
  [
    "road-accident",
    /\b(car crash|car accident|road traffic accident|crash|autounfall|incidente stradale|accidente de trafico)\b|\bcar\b.{0,60}\broof\b/,
  ],
  ["wedding", /\b(wedding|marriage|sposa\w*|nozze|matrimonio|boda|hochzeit|heirat\w*)\b/],
  ["divorce", /\b(divorce|divorcio|divorzio|scheidung)\b/],
  ["diet-interview", /\b(diet|dieta|ernahrung)\b/],
  ["luxury-cars", /\b(luxury cars?|car collection|coches de lujo|auto di lusso|luxusautos?)\b/],
  ["holiday", /\b(holiday|vacation|vacanze|vacaciones|urlaub)\b/],
  ["baby", /\b(baby|newborn|nascita|bebe|geburt)\b/],
  ["house-purchase", /\b(buys? (?:a )?(?:house|mansion)|compra (?:una )?casa|hauskauf)\b/],
  ["party", /\b(nightclub|nightlife|discoteca|party|fiesta|nachtclub)\b/],
  ["kit-reaction", /\b(?:kit|shirt|trikot)\b/],
  ["health-confession", /\b(?:death fears|health fears|death|morte|tod)\b/],
  ["fan-confrontation", /\b(?:confront\w*|abusive|heated exchange|autograph.hunters)\b/],
  ["jibe-response", /\b(?:jibe|taunt|provocazione|stichelei)\b/],
  [
    "title-sanction-demand",
    /\b(?:demands?|reclama|pide)\b.{0,70}\b(?:title|titulo|premier league)\b/,
  ],
  ["training-prank", /\b(?:pranks?|traps|tricks|sabotaging)\b/],
  ["takeover-response", /\b(?:breaks silence|rompe el silencio)\b/],
  ["coach-resignation", /\b(?:resigns?|resigned|resignation|dimissioni|rucktritt)\b/],
  ["awkward-interview", /\b(?:interview\w*|intervista|gesprach)\b/],
  ["ownership-sale", /\b(?:selling|sell|vendita|verkauf)\b/],
];

export function describeTabloidEvent(article: EventArticle): TabloidEventDescriptor | null {
  const headline = normalizeEventText(article.title);
  // The publisher's canonical path carries identity when short RSS titles omit it.
  // Hostname/query/tracking parameters are never semantic evidence.
  let path = "";
  try {
    path = decodeURIComponent(new URL(article.sourceUrl).pathname);
  } catch {
    /* no URL evidence */
  }
  const text = normalizeEventText(`${article.title} ${article.content} ${path}`);
  const persons = entities.filter(([id, re]) => id.startsWith("person:") && re.test(text));
  const headlinePersons = persons.filter(([, re]) => re.test(headline));
  const candidates = headlinePersons.length ? headlinePersons : persons;
  const teams = entities.filter(([id, re]) => id.startsWith("team:") && re.test(headline));
  let entity =
    candidates.length === 1
      ? candidates[0]?.[0]
      : candidates.length === 0 && teams.length === 1
        ? teams[0]?.[0]
        : null;
  const responsePair =
    candidates.length === 2 && /\b(?:jibe|taunt|provocazione|stichelei)\b/.test(headline)
      ? candidates.map(([id]) => id).sort()
      : null;
  if (responsePair) entity = responsePair.join("+");
  if (!entity) return null;
  // A secondary sports/background topic must not override the headline event.
  const headlineTypes = eventTypes.filter(([, re]) => re.test(headline));
  let types = headlineTypes.length ? headlineTypes : eventTypes.filter(([, re]) => re.test(text));
  const requiredContext: Record<string, RegExp> = {
    "kit-reaction": /\b(?:fans?|supporters?|tifosi)\b/,
    "health-confession": /\b(?:fears?|worried|admits?|confess\w*|confessione)\b/,
    "fan-confrontation": /\b(?:fans?|supporters?|autograph\w*)\b/,
    "title-sanction-demand": /\b(?:strip\w*|take|awarded|give|den|sancion\w*)\b/,
    "training-prank": /\b(?:squad|training|stars|players|boss)\b/,
    "takeover-response":
      /\b(?:failed|failing|disappointment)\b.{0,100}\b(?:bid|invest|purchase)|\bfailed attempt\b/,
    "coach-resignation": /\b(?:manager|coach|trainer|allenatore)\b/,
    "awkward-interview": /\b(?:awkward|uncomfortable|surreale|bizar\w*|aussergewohnlich)\b/,
    "ownership-sale": /\b(?:stake|shares|minority|ownership|quote|anteile)\b/,
  };
  types = types.filter(([type]) => !requiredContext[type] || requiredContext[type]!.test(text));
  if (ticketSubject.test(headline) && ticketEnforcement.test(text))
    types.push(["ticket-enforcement", ticketEnforcement]);
  if (types.length !== 1) return null;
  const eventType = types[0]![0];
  const concepts: string[] = [eventType];
  if (eventType === "robbery")
    concepts.push(
      /\b(partner|wife|girlfriend|pareja|novia|esposa|frau|moglie|fidanzata)\b/.test(text)
        ? "victims:player-and-partner"
        : "victim:player",
    );
  if (eventType === "kidnapping-allegation") {
    if (!/\b(allegation\w*|claims?|accus\w*|denies|deny|vorwurf\w*|acusacion\w*)\b/.test(text))
      return null;
    concepts.push("allegation");
  }
  if (eventType === "road-accident") {
    if (!/\b(car|auto|coche|vehicle|land rover)\b/.test(text)) return null;
    concepts.push("vehicle:car");
  }
  const constraints: Record<string, string> = {};
  // Distinguishing topics are event evidence; absence keeps raws separate.
  if (eventType === "kit-reaction") {
    if (!/\b(?:wiesn|oktoberfest|octoberfest)\b/.test(text)) return null;
    concepts.push("occasion:oktoberfest");
    const season = text.match(/\b(20\d{2}) (\d{2})\b/);
    if (!season) return null;
    constraints["season"] = season[0];
  }
  if (eventType === "health-confession") {
    if (!/\b(?:ageing|aging|turning|later years|cognitive|years old)\b/.test(text)) return null;
    concepts.push("topic:ageing");
  }
  if (eventType === "fan-confrontation") {
    if (!/\b(?:abusive|autograph\w*)\b/.test(text)) return null;
    concepts.push("topic:abusive-supporter");
  }
  if (eventType === "jibe-response" && !responsePair) return null;
  if (eventType === "title-sanction-demand") {
    // Only a year syntactically attached to the disputed title is evidence.
    // An actor's previous jobs elsewhere in the body must not date this event.
    const year = text.match(/\b((?:19|20)\d{2}) (?:premier league |league |championship )?title\b/);
    if (year) constraints["competitionYear"] = year[1]!;
    const competition = text.match(
      /\b(premier league|bundesliga|serie a|la liga|champions league)\b/,
    );
    if (!competition) return null;
    constraints["competition"] = competition[1]!;
  }
  if (eventType === "training-prank") {
    if (!/\b(?:panic\w*)\b/.test(text)) return null;
    concepts.push("topic:panic-response");
  }
  if (["takeover-response", "ownership-sale"].includes(eventType)) {
    if (teams.length !== 1) return null;
    constraints["subjectClub"] = teams[0]![0];
  }
  if (eventType === "awkward-interview") {
    const opponent = text.match(/\bbodo (?:glimt)?\b/);
    if (opponent) constraints["opponent"] = "bodo-glimt";
    const broadcaster = text.match(/\bdazn\b/);
    if (broadcaster) constraints["broadcaster"] = "dazn";
  }
  if (eventType === "ticket-enforcement") {
    // A number directly attached to affected tickets/accounts/fans identifies the
    // sanction, rather than an unrelated warning count elsewhere in the article.
    const affected = text.match(
      /\b(\d+) (?:season tickets?|tickets?|accounts?|fans? of their season tickets|abonos?|abbonamenti|dauerkarten)\b/,
    );
    if (!affected) return null;
    constraints["affectedCount"] = affected[1]!;
  }
  const secondaries: Array<[string, RegExp]> = [
    ["alessia-elefante", /\balessia (?:elefante)?\b/],
    ["georgina-rodriguez", /\bgeorgina(?: rodriguez)?\b/],
    ["irina-shayk", /\birina(?: shayk)?\b/],
    ["victoria-beckham", /\bvictoria(?: beckham)?\b/],
  ];
  const partners = secondaries.filter(([, re]) => re.test(text));
  if (partners.length > 1) return null;
  if (partners[0]) constraints["partner"] = partners[0][0];
  // Relationship/holiday news needs a discriminator; otherwise preserve separate raws.
  if (["wedding", "divorce", "baby"].includes(eventType) && !constraints["partner"]) return null;
  const locations: Array<[string, RegExp]> = [
    ["paris", /\bparis\b/],
    ["madrid", /\bmadrid\b/],
    ["london", /\b(london|londres|londra)\b/],
    ["cottingham", /\bcottingham\b/],
    ["ibiza", /\bibiza\b/],
    ["dubai", /\bdubai\b/],
  ];
  const places = locations.filter(([, re]) => re.test(headline));
  if (places.length > 1) return null;
  if (places[0]) constraints["place"] = places[0][0];
  if (eventType === "holiday" && !constraints["place"]) return null;
  const dates = headline.match(/\b20\d{2} \d{1,2} \d{1,2}\b/g) ?? [];
  if (dates.length > 1) return null;
  if (dates[0]) constraints["incidentDate"] = dates[0];
  if (/\b(another|second|again|new robbery|erneut|otra vez|di nuovo)\b/.test(headline)) return null;
  return {
    entity,
    eventType,
    concepts,
    constraints,
    baseKey: JSON.stringify(["tabloid-event@1", entity, eventType, ...concepts]),
  };
}

export function eventCompatible(a: TabloidEventDescriptor, b: TabloidEventDescriptor) {
  return (
    a.baseKey === b.baseKey &&
    Object.entries(a.constraints).every(([k, v]) => !b.constraints[k] || b.constraints[k] === v)
  );
}

/** Persist the first raw as canonical, under the existing advisory lock. No Story/queue writes. */
export async function resolveTabloidEvent(article: EventArticle, repo: EventRepository) {
  const descriptor = describeTabloidEvent(article);
  const at = article.publishedAt ?? article.ingestedAt;
  if (!descriptor || !Number.isFinite(at.getTime()))
    return {
      fingerprint: hash(`tabloid:${article.sourceId}:${article.id}`),
      canonicalRawId: article.id,
      event: null,
      merged: false,
    };
  return repo.withTabloidLock(`event-identity:${descriptor.baseKey}`, async () => {
    const persisted = await repo.getTabloidEvent(article.id);
    if (persisted?.version === 1)
      return {
        fingerprint: persisted.fingerprint,
        canonicalRawId: persisted.canonicalRawId,
        event: persisted,
        merged: persisted.canonicalRawId !== article.id,
      };
    const candidates = (await repo.listTabloidEvents(descriptor.baseKey, at)).filter(
      (candidate) =>
        eventCompatible(descriptor, candidate) &&
        Math.max(at.getTime(), Date.parse(candidate.lastAt)) -
          Math.min(at.getTime(), Date.parse(candidate.firstAt)) <=
          EVENT_WINDOW_MS,
    );
    const own = candidates.find((c) => c.canonicalRawId === article.id);
    // Missing evidence must not bridge two known distinct events.
    const existing = own ?? (candidates.length === 1 ? candidates[0] : undefined);
    const event: TabloidEventIdentity = existing
      ? {
          ...existing,
          constraints: { ...existing.constraints, ...descriptor.constraints },
          firstAt: new Date(Math.min(at.getTime(), Date.parse(existing.firstAt))).toISOString(),
          lastAt: new Date(Math.max(at.getTime(), Date.parse(existing.lastAt))).toISOString(),
        }
      : {
          ...descriptor,
          version: 1,
          canonicalRawId: article.id,
          firstAt: at.toISOString(),
          lastAt: at.toISOString(),
          fingerprint: hash(`tabloid-event@1:${descriptor.baseKey}:${article.id}`),
        };
    if (existing) await repo.saveTabloidEvent(existing.canonicalRawId, event);
    await repo.saveTabloidEvent(article.id, event);
    return {
      fingerprint: event.fingerprint,
      canonicalRawId: event.canonicalRawId,
      event,
      merged: event.canonicalRawId !== article.id,
    };
  });
}
