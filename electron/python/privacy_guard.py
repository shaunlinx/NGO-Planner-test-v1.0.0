import sys
import json
import re
import random
import string

# Try to import spaCy for NER-based anonymization
try:
    import spacy
    NLP_AVAILABLE = True
    # Load English model by default, or fallback
    try:
        nlp = spacy.load("en_core_web_sm")
    except:
        try:
            nlp = spacy.load("zh_core_web_sm")
        except:
            NLP_AVAILABLE = False
            nlp = None
except ImportError:
    NLP_AVAILABLE = False
    nlp = None

class PrivacyGuard:
    def __init__(self):
        self.mapping = {}
        # Regex patterns for common PII
        self.patterns = {
            "EMAIL": r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
            "PHONE": r'\b(\+\d{1,2}\s?)?1[3-9]\d{9}\b|\b(\d{3,4}-)?\d{7,8}\b', # Simple China/US phone match
            "ID_CARD": r'\b\d{15}|\d{18}\b', # Simple ID
        }

    def generate_placeholder(self, entity_type, index):
        return f"<{entity_type}_{index}>"

    def anonymize(self, text):
        mapping = {}
        anonymized_text = text
        counter = {}

        # 1. Regex-based replacement (High precision for format-based PII)
        for pii_type, pattern in self.patterns.items():
            matches = list(set(re.findall(pattern, text))) # Unique matches
            if pii_type not in counter: counter[pii_type] = 0
            
            for match in matches:
                # Check if already mapped (consistency)
                existing_key = None
                for k, v in mapping.items():
                    if v == match:
                        existing_key = k
                        break
                
                if existing_key:
                    placeholder = existing_key
                else:
                    counter[pii_type] += 1
                    placeholder = self.generate_placeholder(pii_type, counter[pii_type])
                    mapping[placeholder] = match
                
                # Replace logic (simple replace all for now, careful with substrings)
                # Use regex sub with word boundary to avoid partial replacement if possible
                anonymized_text = anonymized_text.replace(match, placeholder)

        # 2. NLP-based replacement (Names, Orgs, Locations)
        if NLP_AVAILABLE and nlp:
            doc = nlp(anonymized_text)
            # Iterate entities in reverse to not mess up indices, but simple replace is safer for now
            # We collect entities first
            entities = []
            for ent in doc.ents:
                if ent.label_ in ["PERSON", "ORG", "GPE", "LOC"]:
                    entities.append((ent.text, ent.label_))
            
            # Deduplicate
            entities = list(set(entities))
            
            for ent_text, ent_label in entities:
                # Skip if it looks like a placeholder we just made
                if re.match(r'<.*_\d+>', ent_text):
                    continue

                if ent_label not in counter: counter[ent_label] = 0
                
                existing_key = None
                for k, v in mapping.items():
                    if v == ent_text:
                        existing_key = k
                        break
                
                if existing_key:
                    placeholder = existing_key
                else:
                    counter[ent_label] += 1
                    placeholder = self.generate_placeholder(ent_label, counter[ent_label])
                    mapping[placeholder] = ent_text
                
                anonymized_text = anonymized_text.replace(ent_text, placeholder)

        return {"text": anonymized_text, "mapping": mapping}

    def deanonymize(self, text, mapping):
        restored_text = text
        # Sort mapping keys by length desc to avoid partial matches (e.g. <P_1> vs <P_10>)
        sorted_keys = sorted(mapping.keys(), key=len, reverse=True)
        
        for placeholder in sorted_keys:
            original = mapping[placeholder]
            restored_text = restored_text.replace(placeholder, original)
            
        return {"text": restored_text}

def main():
    guard = PrivacyGuard()

    for line in sys.stdin:
        raw = (line or "").strip()
        if not raw:
            continue

        try:
            request = json.loads(raw)
        except Exception as e:
            sys.stdout.write(json.dumps({"error": f"Invalid JSON input: {str(e)}"}) + "\n")
            sys.stdout.flush()
            continue

        command = request.get("command")
        try:
            if command == "anonymize":
                result = guard.anonymize(request.get("text", ""))
                sys.stdout.write(json.dumps(result) + "\n")
            elif command == "deanonymize":
                result = guard.deanonymize(request.get("text", ""), request.get("mapping", {}))
                sys.stdout.write(json.dumps(result) + "\n")
            else:
                sys.stdout.write(json.dumps({"error": f"Unknown command: {command}"}) + "\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"error": f"Processing failed: {str(e)}"}) + "\n")

        sys.stdout.flush()

if __name__ == "__main__":
    main()
