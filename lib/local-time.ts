/**
 * The lead's own clock. Cold leads span the four US time zones, so "is it a
 * good time to call?" depends on where they are, not where we are.
 *
 * The zone comes from the deal's location ("Rockford, IL"), refined by the
 * phone's area code in the states that straddle two zones, and from the area
 * code alone when there's no location. Pure, so it can be tested alone.
 */

const ET = "America/New_York";
const CT = "America/Chicago";
const MT = "America/Denver";
const PT = "America/Los_Angeles";
const AZ = "America/Phoenix";
const AK = "America/Anchorage";
const HI = "Pacific/Honolulu";

/** Each state's main zone. */
const STATE_ZONE: Record<string, string> = {
  AL: CT, AK, AZ, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET, GA: ET, HI,
  ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET,
  MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT,
  NY: ET, NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT,
  TN: CT, TX: CT, UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT, PR: "America/Puerto_Rico",
};

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

/** In states split between zones, area codes that sit in the other one. */
const SPLIT_AREA_CODES: Record<string, Record<string, string>> = {
  FL: { "850": CT, "448": CT }, // the western Panhandle
  TN: { "423": ET, "865": ET }, // East Tennessee
  KY: { "270": CT, "364": CT }, // western Kentucky
  IN: { "219": CT }, // the northwest corner (Gary)
  TX: { "915": MT }, // El Paso
};

/** Area code → state, for deals with no location. */
const AREA_CODES: Record<string, string> = {};
for (const [state, codes] of Object.entries({
  AL: "205 251 256 334 659 938", AK: "907", AZ: "480 520 602 623 928", AR: "479 501 870 327",
  CA: "209 213 279 310 323 341 350 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951",
  CO: "303 719 720 970 983", CT: "203 475 860 959", DE: "302", DC: "202 771",
  FL: "239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954",
  GA: "229 404 470 478 678 706 762 770 912 943", HI: "808", ID: "208 986",
  IL: "217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872", IN: "219 260 317 463 574 765 812 930",
  IA: "319 515 563 641 712", KS: "316 620 785 913", KY: "270 364 502 606 859", LA: "225 318 337 504 985",
  ME: "207", MD: "227 240 301 410 443 667", MA: "339 351 413 508 617 774 781 857 978",
  MI: "231 248 269 313 517 586 616 679 734 810 906 947 989", MN: "218 320 507 612 651 763 952",
  MS: "228 601 662 769", MO: "314 417 557 573 636 660 816 975", MT: "406", NE: "308 402 531",
  NV: "702 725 775", NH: "603", NJ: "201 551 609 640 732 848 856 862 908 973", NM: "505 575",
  NY: "212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934",
  NC: "252 336 472 704 743 828 910 919 980 984", ND: "701", OH: "216 220 234 283 326 330 380 419 436 440 513 567 614 740 937",
  OK: "405 539 572 580 918", OR: "458 503 541 971", PA: "215 223 267 272 412 445 484 570 582 610 717 724 814 835 878",
  RI: "401", SC: "803 821 839 843 854 864", SD: "605", TN: "423 615 629 731 865 901 931",
  TX: "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979",
  UT: "385 435 801", VT: "802", VA: "276 434 540 571 686 703 757 804 826 948", WA: "206 253 360 425 509 564",
  WV: "304 681", WI: "262 274 353 414 534 608 715 920", WY: "307",
})) for (const code of codes.split(" ")) AREA_CODES[code] = state;

/** "(407) 876-0290" or "+1 407…" → "407". */
export function areaCode(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? ten.slice(0, 3) : null;
}

/** "Rockford, Il" → "IL"; "Little Rock, Arkansas" → "AR"; "Iowa" → "IA". */
export function stateOf(location: string | null | undefined) {
  if (!location) return null;
  const last = location.split(",").pop()!.trim().replace(/\s+\d{5}(-\d{4})?$/, "").replace(/\.$/, "");
  const code = last.toUpperCase();
  if (code.length === 2 && STATE_ZONE[code]) return code;
  return STATE_NAMES[last.toLowerCase()] ?? null;
}

/** The lead's IANA time zone, or null when neither the location nor the phone says. */
export function zoneFor({ location, phone }: { location?: string | null; phone?: string | null }) {
  const area = areaCode(phone);
  const state = stateOf(location) ?? (area ? AREA_CODES[area] : undefined) ?? null;
  if (!state) return null;
  return (area && SPLIT_AREA_CODES[state]?.[area]) || STATE_ZONE[state] || null;
}

const SHORT: Record<string, string> = { [ET]: "ET", [CT]: "CT", [MT]: "MT", [AZ]: "MT", [PT]: "PT", [AK]: "AKT", [HI]: "HT" };

/** "ET", "CT", "MT", "PT". Arizona reads as MT, since that's what callers say. */
export function zoneShort(zone: string) {
  return SHORT[zone] ?? zone.split("/").pop()!.replace(/_/g, " ");
}

function clock(zone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: get("weekday") };
}

/** "9:42 am". */
export function localTime(zone: string, now: Date) {
  const { hour, minute } = clock(zone, now);
  const h = hour % 12 || 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** Business hours for a cold call: weekdays, 8:30 am to 5:00 pm their time. */
export const CALL_WINDOW = { start: 8 * 60 + 30, end: 17 * 60 };

export function isCallable(zone: string | null, now: Date) {
  if (!zone) return false;
  const { hour, minute, weekday } = clock(zone, now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const m = hour * 60 + minute;
  return m >= CALL_WINDOW.start && m < CALL_WINDOW.end;
}

/** Everything the card and panel show: "9:42 am CT", plus whether to call now. */
export function leadClock(input: { location?: string | null; phone?: string | null }, now: Date) {
  const zone = zoneFor(input);
  if (!zone) return null;
  return { zone, label: `${localTime(zone, now)} ${zoneShort(zone)}`, callable: isCallable(zone, now) };
}
