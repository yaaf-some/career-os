use serde_json::{Map, Number, Value};

#[derive(Debug, Clone)]
struct Line {
    indent: usize,
    text: String,
    line_no: usize,
}

/// Parses the YAML subset used in `profile/*.yml` and Markdown frontmatter into `serde_json::Value`.
///
/// Supports nested mappings, block sequences (`- item`), inline sequences (`[a, b]`),
/// `#` comments, single/double quoted strings, booleans, numbers, and `null` / `~`.
pub fn parse_yaml_to_json(input: &str) -> Result<Value, String> {
    let mut lines = Vec::new();
    for (idx, raw) in input.lines().enumerate() {
        let no_cr = raw.strip_suffix('\r').unwrap_or(raw);
        let uncommented = strip_comment(no_cr);
        let trimmed_end = uncommented.trim_end();
        if trimmed_end.trim().is_empty() {
            continue;
        }
        let trimmed_start = trimmed_end.trim_start_matches(' ');
        if trimmed_start.starts_with('\t') {
            return Err(format!(
                "line {}: tabs are not supported for indentation",
                idx + 1
            ));
        }
        let indent = trimmed_end.len() - trimmed_start.len();
        lines.push(Line {
            indent,
            text: trimmed_start.to_string(),
            line_no: idx + 1,
        });
    }

    if lines.is_empty() {
        return Ok(Value::Object(Map::new()));
    }

    let mut cursor = 0usize;
    let val = parse_block(&lines, &mut cursor, lines[0].indent)?;
    Ok(val)
}

fn strip_comment(line: &str) -> &str {
    let mut in_single = false;
    let mut in_double = false;
    let mut escape = false;
    let bytes = line.as_bytes();
    for (i, ch) in line.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if in_double {
            if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_double = false;
            }
            continue;
        }
        if in_single {
            if ch == '\'' {
                in_single = false;
            }
            continue;
        }
        match ch {
            '\'' => in_single = true,
            '"' => in_double = true,
            '#' if i == 0 || bytes[i - 1] == b' ' || bytes[i - 1] == b'\t' => {
                return &line[..i];
            }
            _ => {}
        }
    }
    line
}

fn is_seq_item(text: &str) -> bool {
    text == "-" || text.starts_with("- ")
}

fn parse_block(lines: &[Line], cursor: &mut usize, min_indent: usize) -> Result<Value, String> {
    if *cursor >= lines.len() || lines[*cursor].indent < min_indent {
        return Ok(Value::Null);
    }
    let block_indent = lines[*cursor].indent;
    if is_seq_item(&lines[*cursor].text) {
        parse_sequence(lines, cursor, block_indent)
    } else {
        parse_mapping(lines, cursor, block_indent)
    }
}

fn parse_sequence(lines: &[Line], cursor: &mut usize, seq_indent: usize) -> Result<Value, String> {
    let mut items = Vec::new();
    while *cursor < lines.len() {
        let line = &lines[*cursor];
        if line.indent < seq_indent || line.indent != seq_indent || !is_seq_item(&line.text) {
            break;
        }
        let rest = line.text.strip_prefix('-').unwrap_or("").trim_start();
        let line_no = line.line_no;
        *cursor += 1;

        if rest.is_empty() {
            if *cursor < lines.len() && lines[*cursor].indent > seq_indent {
                items.push(parse_block(lines, cursor, lines[*cursor].indent)?);
            } else {
                items.push(Value::Null);
            }
        } else if rest.starts_with('[') && rest.ends_with(']') {
            items.push(parse_inline_array(rest, line_no)?);
        } else if let Some((k, v)) = split_key_value(rest) {
            let mut map = Map::new();
            let key = unquote_key(k, line_no)?;
            let val = if v.is_empty() {
                if *cursor < lines.len() && lines[*cursor].indent > seq_indent {
                    parse_block(lines, cursor, lines[*cursor].indent)?
                } else {
                    Value::Null
                }
            } else {
                parse_value_str(v, line_no)?
            };
            map.insert(key, val);

            if *cursor < lines.len()
                && lines[*cursor].indent > seq_indent
                && !is_seq_item(&lines[*cursor].text)
            {
                let child_indent = lines[*cursor].indent;
                let extra = parse_mapping(lines, cursor, child_indent)?;
                if let Value::Object(extra_map) = extra {
                    for (ek, ev) in extra_map {
                        map.insert(ek, ev);
                    }
                }
            }
            items.push(Value::Object(map));
        } else {
            items.push(parse_value_str(rest, line_no)?);
        }
    }
    Ok(Value::Array(items))
}

fn parse_mapping(lines: &[Line], cursor: &mut usize, map_indent: usize) -> Result<Value, String> {
    let mut map = Map::new();
    while *cursor < lines.len() {
        let line = &lines[*cursor];
        if line.indent < map_indent || line.indent != map_indent || is_seq_item(&line.text) {
            break;
        }
        let line_no = line.line_no;
        let Some((raw_key, val_rest)) = split_key_value(&line.text) else {
            return Err(format!(
                "line {line_no}: expected 'key: value', got '{}'",
                line.text
            ));
        };
        let key = unquote_key(raw_key, line_no)?;
        *cursor += 1;

        let val = if val_rest.is_empty() {
            if *cursor < lines.len() && lines[*cursor].indent > map_indent {
                parse_block(lines, cursor, lines[*cursor].indent)?
            } else if *cursor < lines.len()
                && lines[*cursor].indent == map_indent
                && is_seq_item(&lines[*cursor].text)
            {
                parse_sequence(lines, cursor, map_indent)?
            } else {
                Value::Null
            }
        } else {
            parse_value_str(val_rest, line_no)?
        };
        map.insert(key, val);
    }
    Ok(Value::Object(map))
}

fn split_key_value(text: &str) -> Option<(&str, &str)> {
    let mut in_single = false;
    let mut in_double = false;
    let mut escape = false;
    let bytes = text.as_bytes();
    for (i, ch) in text.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if in_double {
            if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_double = false;
            }
            continue;
        }
        if in_single {
            if ch == '\'' {
                in_single = false;
            }
            continue;
        }
        match ch {
            '\'' => in_single = true,
            '"' => in_double = true,
            ':' => {
                let next_is_boundary =
                    i + 1 == bytes.len() || bytes[i + 1] == b' ' || bytes[i + 1] == b'\t';
                if next_is_boundary {
                    let key = text[..i].trim();
                    let val = text[i + 1..].trim();
                    return Some((key, val));
                }
            }
            _ => {}
        }
    }
    None
}

fn unquote_key(raw: &str, line_no: usize) -> Result<String, String> {
    if (raw.starts_with('"') && raw.ends_with('"'))
        || (raw.starts_with('\'') && raw.ends_with('\''))
    {
        parse_quoted_string(raw, line_no)
    } else {
        Ok(raw.to_string())
    }
}

fn parse_value_str(raw: &str, line_no: usize) -> Result<Value, String> {
    let s = raw.trim();
    if s.starts_with('[') && s.ends_with(']') {
        return parse_inline_array(s, line_no);
    }
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        return Ok(Value::String(parse_quoted_string(s, line_no)?));
    }
    match s {
        "null" | "~" => Ok(Value::Null),
        "true" | "True" | "TRUE" => Ok(Value::Bool(true)),
        "false" | "False" | "FALSE" => Ok(Value::Bool(false)),
        _ => {
            if let Ok(i) = s.parse::<i64>() {
                return Ok(Value::Number(Number::from(i)));
            }
            if let Ok(f) = s.parse::<f64>() {
                if let Some(n) = Number::from_f64(f) {
                    return Ok(Value::Number(n));
                }
            }
            Ok(Value::String(s.to_string()))
        }
    }
}

fn parse_quoted_string(raw: &str, line_no: usize) -> Result<String, String> {
    if raw.starts_with('\'') && raw.ends_with('\'') && raw.len() >= 2 {
        return Ok(raw[1..raw.len() - 1].replace("''", "'"));
    }
    if raw.starts_with('"') && raw.ends_with('"') && raw.len() >= 2 {
        let inner = &raw[1..raw.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(ch) = chars.next() {
            if ch == '\\' {
                match chars.next() {
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('t') => out.push('\t'),
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some(other) => {
                        out.push('\\');
                        out.push(other);
                    }
                    None => out.push('\\'),
                }
            } else {
                out.push(ch);
            }
        }
        return Ok(out);
    }
    Err(format!("line {line_no}: unterminated quoted string"))
}

fn parse_inline_array(raw: &str, line_no: usize) -> Result<Value, String> {
    let inner = raw[1..raw.len() - 1].trim();
    if inner.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escape = false;

    for ch in inner.chars() {
        if escape {
            current.push(ch);
            escape = false;
            continue;
        }
        if in_double {
            if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_double = false;
            }
            current.push(ch);
            continue;
        }
        if in_single {
            if ch == '\'' {
                in_single = false;
            }
            current.push(ch);
            continue;
        }
        match ch {
            '\'' => {
                in_single = true;
                current.push(ch);
            }
            '"' => {
                in_double = true;
                current.push(ch);
            }
            ',' => {
                parts.push(parse_value_str(current.trim(), line_no)?);
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(parse_value_str(current.trim(), line_no)?);
    }
    Ok(Value::Array(parts))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_yaml_maps_lists_scalars_and_comments() {
        let yaml = r#"
# Top comment
schema_version: 1
status: verified
candidate:
  years_of_experience: 2
  authorized_in:
    - "United States"
  needs_sponsorship: false
compensation:
  minimum: null # tbd
  target_range: "90000-120000+"
scoring_weights:
  role_stack: 35
  level_reachability: 25
  vibe_culture: 25
  logistics_comp: 15
use_in: [hydrogen, neon, "cover_letter"]
url_note: "https://example.com/a#b"
"#;
        let json = parse_yaml_to_json(yaml).expect("parse yaml");
        assert_eq!(json["schema_version"], 1);
        assert_eq!(json["status"], "verified");
        assert_eq!(json["candidate"]["years_of_experience"], 2);
        assert_eq!(json["candidate"]["authorized_in"][0], "United States");
        assert_eq!(json["candidate"]["needs_sponsorship"], false);
        assert!(json["compensation"]["minimum"].is_null());
        assert_eq!(json["compensation"]["target_range"], "90000-120000+");
        assert_eq!(json["scoring_weights"]["vibe_culture"], 25);
        assert_eq!(json["use_in"][2], "cover_letter");
        assert_eq!(json["url_note"], "https://example.com/a#b");
    }

    #[test]
    fn parses_sequence_of_maps_and_unindented_sequences() {
        let yaml = r#"
roles:
- "Platform Engineer"
- "DevOps Engineer"
items:
  - name: "Lab 00"
    active: true
  - name: "Lab 01"
    active: false
"#;
        let json = parse_yaml_to_json(yaml).expect("parse sequences");
        assert_eq!(json["roles"][0], "Platform Engineer");
        assert_eq!(json["roles"][1], "DevOps Engineer");
        assert_eq!(json["items"][0]["name"], "Lab 00");
        assert_eq!(json["items"][0]["active"], true);
        assert_eq!(json["items"][1]["active"], false);
    }
}
