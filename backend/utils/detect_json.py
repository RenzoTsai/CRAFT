import json

# Try to import json_repair for robust LLM JSON parsing
try:
    from json_repair import repair_json
    HAS_JSON_REPAIR = True
except ImportError:
    HAS_JSON_REPAIR = False

def detect_json(string):
    """
    Robustly detect and parse JSON from LLM output, using json_repair if available.
    Handles invalid escapes, missing brackets, and supports Chinese.
    """
    if HAS_JSON_REPAIR:
        try:
            # Try to repair and parse JSON, preserving non-ASCII (Chinese)
            fixed = repair_json(string, ensure_ascii=False)
            return json.loads(fixed)
        except Exception as e:
            print(f"json_repair failed: {e}")
            # fallback to original logic
    # Fallback: naive bracket extraction
    start_index = string.find('{')
    end_index = string.rfind('}')
    if start_index == -1 or end_index == -1 or start_index > end_index:
        return None
    try:
        return json.loads(string[start_index:end_index + 1])
    except ValueError as v:
        print(v)
        return None

