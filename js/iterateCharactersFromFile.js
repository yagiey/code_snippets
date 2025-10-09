// ファイルから1文字ずつ列挙する
async function* iterateCharactersFromFile(file) {
    let fragment = new Uint8Array(0);
    for await (const chunk of iterateChunksFromFile(file)) {
        const chunkSize = chunk.length;
        let start = 0;
        while (start < chunkSize) {
            // 文字のバイト数
            let n;

            if (start === 0 && fragment.length > 0) {
                // 前のchunkの最後の断片が残っている場合

                // 断片から始まる文字の文字コードのバイト数
                n = charBytes(fragment[0]);

                // 新しいchunkにまたがるバイト数
                const remainSize = n - fragment.length;

                if (start + remainSize > chunkSize) {
                    // いきなりこのchunkも持ち越し。
                    fragment = new Uint8Array([...fragment, ...chunk]);
                    start = chunkSize;
                    continue;
                }

                const remain = chunk.slice(start, remainSize);

                // chunkの断片と残りをつなげて、完全な文字コードにする
                const combined = new Uint8Array([...fragment, ...remain]);
                yield combined;

                // 後始末
                fragment = new Uint8Array(0);
                start = remainSize;
            }

            n = charBytes(chunk[start]);
            let end;
            let carryOver = false;
            if (start + n > chunkSize) {
                // この文字は次のchunkへかかる。
                // バイト列断片は次へ持ち越して、次のchunkへ。
                end = chunkSize;
                carryOver = true;
            } else {
                end = start + n;
            }

            const character = chunk.slice(start, end);

            if (carryOver) {
                fragment = character;
            } else {
                yield character;
            }

            start = end;
        }
    }

    if (fragment.length > 0) {
        console.log('UTF-8ではない');
    }
}

// chunkのサイズ（1MB）
const CHUNK_SIZE = 1 * 1024 * 1024;

// 大きいファイルをchunkに分けて列挙する
async function* iterateChunksFromFile(file) {
    let offset = 0;
    while (offset < file.size) {
        const want = CHUNK_SIZE;
        // 終端越え防止
        const end  = Math.min(offset + want, file.size);
        // この範囲だけ読む
        const buf  = await file.slice(offset, end).arrayBuffer();
        // チャンクを返す
        yield new Uint8Array(buf);
        offset = end;
    }
}

// 最初の1バイト（2桁の16進数）を与えて、文字のバイト数を判断する
function charBytes (head) {
    if (240 <= head) {
        // 4バイト文字: 1バイト目が1111 0xxx
        return 4;
    } else if (224 <= head) {
        // 3バイト文字: 1バイト目が1110 xxxx
        return 3;
    } else if (192 <= head) {
        // 2バイト文字: 1バイト目が110x xxxx
        return 2;
    } else {
        // 1バイト文字: 1バイト目が0xxx xxxx
        return 1;
    }
}
