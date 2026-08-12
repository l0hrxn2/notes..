// Vercel Serverless Function — looks up a word's Korean meaning by calling
// Naver English Dictionary's internal search endpoint directly (scraping),
// instead of the official Oxford API.
//
// ⚠️ IMPORTANT — read before relying on this in production:
// - This calls an UNDOCUMENTED, UNOFFICIAL Naver endpoint. It is not a
//   published public API, and Naver's terms of service generally prohibit
//   automated scraping of this kind.
// - Naver can change the response shape or block this endpoint at any time
//   without notice — there is no stability guarantee.
// - Heavy or sustained traffic from one server IP can get rate-limited or
//   blocked.
// - This code was written from the commonly-observed shape of Naver's
//   internal API (used by their own web dictionary's frontend), but it could
//   not be tested against a live network call in this environment. If word
//   lookups come back empty after you deploy, open your browser devtools on
//   https://en.dict.naver.com , search a word, check the Network tab for the
//   actual request Naver's own page makes, and adjust the `url` and the
//   `items` / `meansCollector` field paths below to match.
//
// If this ever breaks or gets blocked, the Oxford-API version from before
// (api/dictionary.js with OXFORD_APP_ID/OXFORD_APP_KEY) is the safer fallback.

const POS_MAP = {
  '명사': 'n',
  '동사': 'v',
  '형용사': 'adj',
  '부사': 'adv',
  '전치사': 'prep',
  '접속사': 'conj',
  '대명사': 'pron',
  '감탄사': 'interj',
  '조동사': 'aux',
  '관사': 'art',
};

function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '').trim();
}

export default async function handler(req, res) {
  const word = (req.query.word || '').toString().trim().toLowerCase();
  if (!word) {
    res.status(400).json({ error: 'word query param is required' });
    return;
  }

  try {
    const url = `https://en.dict.naver.com/api3/enko/search?query=${encodeURIComponent(word)}`;
    const naverRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer': 'https://en.dict.naver.com/',
        'Accept': 'application/json',
      },
    });

    if (!naverRes.ok) {
      res.status(naverRes.status).json({ error: `naver dictionary error (${naverRes.status})` });
      return;
    }

    const data = await naverRes.json();
    const items = data?.searchResultMap?.searchResultListMap?.WORD?.items || [];

    if (items.length === 0) {
      res.status(404).json({ error: 'not found', meaning: '' });
      return;
    }

    // The WORD section mixes exact word entries with idioms/phrases that
    // merely contain the query (e.g. "like a dose of salts" for "dose").
    // exactMatch / handleEntry tell us which one is the real headword.
    const entry =
      items.find(it => it.exactMatch === true && it.handleEntry?.toLowerCase() === word) ||
      items.find(it => it.handleEntry?.toLowerCase() === word) ||
      items[0];

    const lines = [];
    for (const group of entry.meansCollector || []) {
      const posKo = group.partOfSpeech || '';
      const abbr = POS_MAP[posKo] || posKo.slice(0, 2) || '';
      for (const m of (group.means || []).slice(0, 3)) {
        const text = stripHtml(m.value);
        if (text) lines.push(abbr ? `${abbr}. ${text}` : text);
      }
    }

    // If we fell back to a non-exact entry, Naver's closest-match headword
    // (handleEntry) often IS the correctly-spelled word for a typo (e.g.
    // "appla" -> "apple"). Only treat it as a correction when it's a single
    // word, not an idiom/phrase, and actually differs from what was typed —
    // otherwise this would misfire on idiom fallbacks like "a dose of ~".
    const rawHeadword = (entry.handleEntry || '').toLowerCase().trim();
    const correctedWord = (rawHeadword && !rawHeadword.includes(' ') && rawHeadword !== word) ? rawHeadword : null;

    // Naver's entries carry real native-speaker recordings, not synthesized
    // TTS. Prefer the US recording (matches the app's "미국식 영어 발음"
    // requirement), fall back to UK if that's all that's available. Idiom
    // fallback entries often have no phonetic files at all, in which case
    // the client falls back to Google TTS.
    const phonetics = entry.searchPhoneticSymbolList || [];
    const usAudio = phonetics.find(p => p.symbolType === '미국식' && p.symbolFile)?.symbolFile;
    const gbAudio = phonetics.find(p => p.symbolType === '영국식' && p.symbolFile)?.symbolFile;
    const audioUrl = usAudio || gbAudio || null;

    res.status(200).json({ meaning: lines.join('\n'), correctedWord, audioUrl });
  } catch (err) {
    console.error('naver dictionary proxy failed', err);
    res.status(500).json({ error: 'proxy request failed' });
  }
}
