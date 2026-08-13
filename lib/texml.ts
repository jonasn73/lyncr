/**
 * Telnyx TeXML builder (TwiML-compatible XML).
 * Replaces the old Twilio VoiceResponse helper — Telnyx accepts the same verbs.
 */

type AttrValue = string | number | boolean | string[] | null | undefined
type AttrMap = Record<string, AttrValue>

function escapeXmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeXmlAttr(text: string): string {
  return escapeXmlText(text).replace(/"/g, "&quot;")
}

function attrString(value: AttrValue): string | null {
  if (value === undefined || value === null || value === false) return null
  if (value === true) return "true"
  if (Array.isArray(value)) return value.map(String).join(" ")
  return String(value)
}

function serializeAttrs(attrs?: AttrMap): string {
  if (!attrs) return ""
  const parts: string[] = []
  for (const [key, raw] of Object.entries(attrs)) {
    const value = attrString(raw)
    if (value === null) continue
    parts.push(`${key}="${escapeXmlAttr(value)}"`)
  }
  return parts.length ? ` ${parts.join(" ")}` : ""
}

class TexmlNode {
  constructor(
    private readonly tag: string,
    private readonly attrs: AttrMap = {},
    private readonly children: Array<TexmlNode | string> = [],
    private readonly selfClosing = false
  ) {}

  append(child: TexmlNode | string): this {
    this.children.push(child)
    return this
  }

  toXml(): string {
    const open = `<${this.tag}${serializeAttrs(this.attrs)}`
    if (this.selfClosing && this.children.length === 0) return `${open}/>`
    const inner = this.children
      .map((c) => (typeof c === "string" ? c : c.toXml()))
      .join("")
    return `${open}>${inner}</${this.tag}>`
  }
}

/** Nested `<Dial>` — add one or more `<Number>` targets. */
export class TexmlDial {
  constructor(private readonly node: TexmlNode) {}

  number(phoneOrAttrs: string | AttrMap, phone?: string): this {
    if (typeof phoneOrAttrs === "string") {
      this.node.append(new TexmlNode("Number", {}, [escapeXmlText(phoneOrAttrs)]))
      return this
    }
    this.node.append(new TexmlNode("Number", phoneOrAttrs, [escapeXmlText(String(phone ?? ""))]))
    return this
  }
}

/** Nested `<Gather>` — usually contains `<Say>`. */
export class TexmlGather {
  constructor(private readonly node: TexmlNode) {}

  say(attrsOrText: AttrMap | string, text?: string): this {
    if (typeof attrsOrText === "string") {
      this.node.append(new TexmlNode("Say", {}, [escapeXmlText(attrsOrText)]))
      return this
    }
    this.node.append(new TexmlNode("Say", attrsOrText, [escapeXmlText(String(text ?? ""))]))
    return this
  }
}

/** Root `<Response>` document Telnyx fetches for TeXML. */
export class VoiceResponse {
  private readonly root = new TexmlNode("Response")

  say(attrsOrText: AttrMap | string, text?: string): this {
    if (typeof attrsOrText === "string") {
      this.root.append(new TexmlNode("Say", {}, [escapeXmlText(attrsOrText)]))
      return this
    }
    this.root.append(new TexmlNode("Say", attrsOrText, [escapeXmlText(String(text ?? ""))]))
    return this
  }

  pause(attrs: { length?: number } = {}): this {
    this.root.append(new TexmlNode("Pause", attrs, [], true))
    return this
  }

  hangup(): this {
    this.root.append(new TexmlNode("Hangup", {}, [], true))
    return this
  }

  redirect(attrsOrUrl: AttrMap | string, url?: string): this {
    if (typeof attrsOrUrl === "string") {
      this.root.append(new TexmlNode("Redirect", {}, [escapeXmlText(attrsOrUrl)]))
      return this
    }
    this.root.append(new TexmlNode("Redirect", attrsOrUrl, [escapeXmlText(String(url ?? ""))]))
    return this
  }

  record(attrs: AttrMap = {}): this {
    this.root.append(new TexmlNode("Record", attrs, [], true))
    return this
  }

  play(attrsOrUrl: AttrMap | string, url?: string): this {
    if (typeof attrsOrUrl === "string") {
      this.root.append(new TexmlNode("Play", {}, [escapeXmlText(attrsOrUrl)]))
      return this
    }
    this.root.append(new TexmlNode("Play", attrsOrUrl, [escapeXmlText(String(url ?? ""))]))
    return this
  }

  dial(attrs: AttrMap = {}): TexmlDial {
    const node = new TexmlNode("Dial", attrs)
    this.root.append(node)
    return new TexmlDial(node)
  }

  gather(attrs: AttrMap = {}): TexmlGather {
    const node = new TexmlNode("Gather", attrs)
    this.root.append(node)
    return new TexmlGather(node)
  }

  toString(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>${this.root.toXml()}`
  }
}
