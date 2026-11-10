"""Offline acoustic decoding first, then comparison with the reviewed original words."""
import hashlib
import json
import os
from pathlib import Path
import sys
import wave

request_path, result_path = map(Path, sys.argv[1:])
request = json.loads(request_path.read_text())
cache = Path(request['cache'])
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                  HF_HOME=str(cache / 'hf'), OPENPRONOUNCE_DEVICE='cpu',
                  OPENPRONOUNCE_PHONEME_MODEL=str(cache / 'model'))
sys.path.insert(0, str(cache / 'vendor'))

import numpy as np
import torch
import espeakng_loader
from phonemizer import phonemize
from phonemizer.backend.espeak.wrapper import EspeakWrapper
EspeakWrapper.set_library(espeakng_loader.get_library_path())
EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
from openpronounce import phones

with wave.open(request['wav']) as stream:
    assert stream.getframerate() == 16000 and stream.getnchannels() == 1 and stream.getsampwidth() == 2
    audio = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32) / 32768
torch.set_num_threads(4)
results = []
for index, segment in enumerate(request['segments']):
    key = hashlib.sha256((request['requestKey'] + str(index)).encode()).hexdigest()
    cached = result_path.parent / f'{key}.json'
    result = None
    if cached.exists():
        try:
            saved = json.loads(cached.read_text())
            if saved['requestKey'] == request['requestKey'] and saved['result']['referenceText'] == segment['referenceText']:
                result = saved['result']
        except (ValueError, KeyError, TypeError):
            pass
    if result is None:
        clip = audio[segment['startMs'] * 16:segment['endMs'] * 16]
        assert len(clip) > 0
        recognition = phones.recognize_phones(clip)
        words = phones._word_reports(recognition, segment['referenceText'])
        assert [w['word'] for w in words] == [w['word'] for w in segment['words']], 'Phonemizer changed reference words'
        assert all(w['expected'] for w in words), 'Missing target phones'
        alignment = phones._align([p for w in words for p in w['expected']], recognition.phones)
        offset = 0
        for word in words:
            matched = sorted(set().union(*(alignment[k] for k in range(offset, offset + len(word['expected'])))))
            offset += len(word['expected'])
            word['ipa'] = phonemize(word['word'], language='en-us', backend='espeak', strip=True, with_stress=True).strip()
            word['audioStartMs'] = round(segment['startMs'] + recognition.spans[matched[0]][0] / len(recognition.log_posteriors) * len(clip) / 16) if matched else None
            word['audioEndMs'] = round(segment['startMs'] + recognition.spans[matched[-1]][1] / len(recognition.log_posteriors) * len(clip) / 16) if matched else None
        result = dict(startMs=segment['startMs'], endMs=segment['endMs'], referenceText=segment['referenceText'],
                      words=words, decodedPhones=recognition.phones,
                      comparison=phones.compare_phones(recognition, segment['referenceText']))
        cached.write_text(json.dumps(dict(requestKey=request['requestKey'], result=result), ensure_ascii=False))
    results.append(result)
    print(f'Wav2Vec2 {index + 1}/{len(request["segments"])}: {len(result["comparison"]["errors"])} candidates', flush=True)
result_path.write_text(json.dumps(dict(requestKey=request['requestKey'], segments=results,
    thresholds=dict(phoneShare=phones.PHONE_ERROR_THRESHOLD, weightedEdits=phones.PHONE_ERROR_MIN_EDITS)), ensure_ascii=False))
