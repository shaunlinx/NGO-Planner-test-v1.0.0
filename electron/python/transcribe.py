import sys
import json
import os
import datetime

# Attempt to import faster_whisper, handle missing dependency gracefully
try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "faster-whisper not installed. Please install it using: pip install faster-whisper"}))
    sys.exit(1)

def format_timestamp(seconds):
    return str(datetime.timedelta(seconds=seconds)).split('.')[0]

def transcribe(file_path):
    # 'base' model is a good balance for CPU. 'tiny' is faster but less accurate.
    # 'int8' is default quantization for CPU.
    model_size = "base" 
    
    try:
        # Run on CPU with INT8 quantization
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
    except Exception as e:
        print(json.dumps({"error": f"Model loading failed: {str(e)}"}))
        return

    try:
        segments, info = model.transcribe(file_path, beam_size=5)

        output_text = []
        for segment in segments:
            start = format_timestamp(segment.start)
            end = format_timestamp(segment.end)
            text = segment.text.strip()
            # Format: [00:00:10 --> 00:00:15] Hello world
            output_text.append(f"[{start} --> {end}] {text}")

        # Output the result as JSON
        print(json.dumps({"text": "\n".join(output_text)}))
        
    except Exception as e:
        print(json.dumps({"error": f"Transcription failed: {str(e)}"}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)
        
    transcribe(file_path)
