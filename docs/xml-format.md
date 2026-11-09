# MachSim XML exchange format (version 1)

File > Export MachSim XML writes a design as XML; File > Open reads it back. The XML holds exactly
the data of the `.msim` JSON file (see `src/model/types.ts` for the meaning of every field), so
other tools can read and write MachSim designs with any XML library, and a round trip
`.msim → .xml → .msim` is lossless: the same members, in the same order, with the same values.
Implementation: `src/model/xmlDesign.ts` (mapping), `src/util/xml.ts` (reader / escaping); tests:
`src/model/xmlDesign.test.ts` (round trip on every sample design).

## Document

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- MachSim design exchange file (docs/xml-format.md) -->
<machsim-design xmlns="urn:machsim:design-xml:1" xml-format="1" saved-by="MachSim 0.1.0">
  <format>machsim-design</format>
  <version type="number">2</version>
  <title>RC low-pass filter</title>
  <sheets type="array">
    <sheet>
      <id>sheet1</id>
      <name>Sheet 1</name>
      <parts type="array">
        <part>
          <id>p1</id>
          <partId>basic/resistor</partId>
          <refdes>R1</refdes>
          <x type="number">230</x>
          <y type="number">200</y>
          <rotation type="number">0</rotation>
          <mirror type="boolean">false</mirror>
          <params>
            <value>1k</value>
          </params>
        </part>
      </parts>
      <wires type="array"> … </wires>
      <labels type="array"/>
      <probes type="array"/>
      <notes type="array"/>
    </sheet>
  </sheets>
  <analysis>
    <active>tran</active>
    <specs>
      <tran>
        <type>tran</type>
        <tstep type="number">5e-6</tstep>
        <tstop type="number">0.005</tstop>
      </tran>
    </specs>
  </analysis>
  <options type="object"/>
  <variables type="object"/>
</machsim-design>
```

- The root element is `machsim-design`. Its attributes describe the file, not the design:
  `xmlns="urn:machsim:design-xml:1"`, `xml-format` (this document's version, `1`; readers refuse a
  larger number) and `saved-by` (the program that wrote it). The root's children are the members
  of the design object (`format`, `version`, `title`, `sheets`, …).
- Encoding UTF-8; line ends LF. Readers accept CR LF, comments, processing instructions, a
  DOCTYPE without internal subset and CDATA sections.

## Values

Every JSON value is one element. The `type` attribute says which kind of value it holds:

| JSON value | XML | Example |
|---|---|---|
| object | child elements = members, in order; `type="object"` only when empty | `<params><value>1k</value></params>`, `<options type="object"/>` |
| array | `type="array"`, one child per item | `<points type="array"><point>…</point></points>` |
| string | text content, no attribute; an empty element is the empty string | `<name>Sheet 1</name>`, `<description/>` |
| number | `type="number"`, the shortest decimal text that reads back to the same IEEE 754 double | `<x type="number">230</x>`, `<tstep type="number">5e-6</tstep>` |
| boolean | `type="boolean"`, `true` or `false` | `<mirror type="boolean">false</mirror>` |
| null | `type="null"`, empty | `<model type="null"/>` |

- **Array items** are named after the array: `sheets` → `sheet`, `parts` → `part`, `children` →
  `child`, `…ies` → `…y` (`entries` would be `entry`, but see below), other plural names lose their
  final `s`; anything else (and nested arrays) uses `item`. Readers accept any item name.
- **Member names** that are valid XML names are written as the element name (`A.scale`,
  `trig.source` are valid). A member whose name is not a valid XML name (it starts with a digit,
  contains a space or a colon, or starts with `xml`), and the member named `entry`, is written as
  `<entry key="…">`. An `entry` element without `key` is read as a member named `entry`.
- **Text** keeps every character, white space included. `&`, `<`, `>` are escaped as usual; a
  carriage return is written as `&#13;` so XML line-end normalisation cannot remove it. A string
  that contains characters XML cannot hold (C0 control characters other than TAB / LF / CR, lone
  surrogates, U+FFFE / U+FFFF) is written with `encoding="json"` and a JSON string literal as its
  text: `<note encoding="json">"bell\u0007"</note>`.
- Unknown `type` or `encoding` values, text between members of an object, duplicate members and
  malformed XML are errors (reported with the line number).

## Reading

The value read from the root is the raw design object. It goes through the same migration and
validation as a `.msim` file (`migrateDesign`, `validateDesign` in `src/model/serialize.ts`), so an
XML file written for an older design format version is upgraded, and invalid content is reported
with JSON-style paths (`sheets[0].parts[2].rotation: …`).
