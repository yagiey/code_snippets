/**
 * UTF-8への対応を追加した、RFC 4180に基づくCSVの構文解析器
 *
 * - レコードの区切り:
 *   * RFC4180厳格モードではCRLF
 *   * オプションを指定すると、単独LF、単独CRも許容
 * 
 * - フィールド:
 *   * 引用符なしフィールドは、厳格モードではカンマ、引用符、CR、LF、C0制御文字、DELを含んではならない
 *   * 引用符ありフィールドは、2個続きの引用符を1個の引用符として扱う。カンマ、CR、LFを含められる
 *
 * @param {string} input  - UTF-8 decoded JS string
 * @param {Object} [opts]
 * @param {boolean} [opts.strict=true]          - RFC4180に厳格に従うモード
 * @param {boolean} [opts.allowBareLF=false]    - 単独LFをレコードの終わりとして扱う
 * @param {boolean} [opts.allowBareCR=false]    - 単独CRをレコードの終わりとして扱う
 * @returns {string[][]} 行のコレクション
 * @throws {SyntaxError} RFC4180厳格モードで不正なCSV
 */
function parseCSV(input, opts = {}) {
    const strict = opts.strict !== false;
    const allowBareLF = !!opts.allowBareLF;
    const allowBareCR = !!opts.allowBareCR;

    const COMMA = ",";
    const DQ = '"';
    const CR = "\r";
    const LF = "\n";

    const rows = [];
    let row = [];
    let field = "";

    const STATE = {
        //　今からフィールドが始まる
        START_FIELD: 0,
        // 引用符なしフィールドの内部
        IN_FIELD: 1,
        // 引用符付きフィールドの内部
        IN_QUOTED: 2,
        // 引用符付きフィールドの内部で引用符が出てきた直後
        AFTER_QUOTE: 3,
    };
    let state = STATE.START_FIELD;

    // 制御文字かどうか
    function isControl(ch) {
        const code = ch.codePointAt(0);
        return (0x00 <= code && code <= 0x1F) || code === 0x7F;
    }
    // フィールド終了処理
    function endField() {
        row.push(field);
        field = "";
    }
    // レコード終了処理
    function endRecord() {
        endField();
        rows.push(row);
        row = [];
    }

    // 1文字先読みしつつ、文字を走査
    let i = 0;
    const n = input.length;

    while (i < n) {
        const ch = input[i];

        // 1文字先読み
        const next = i + 1 < n ? input[i + 1] : "";
        // chとnextでCRLFになっているか
        const hasCRLF = ch === CR && next === LF;

        switch (state) {
            case STATE.START_FIELD: {
                if (ch === DQ) {
                    state = STATE.IN_QUOTED;
                    i += 1;
                    break;
                }
                if (ch === COMMA) {
                    // 空のフィールドだった
                    endField();
                    i += 1;
                    break;
                }
                if (hasCRLF) {
                    // 空のフィールドでレコードが終わった
                    endRecord();
                    i += 2;
                    break;
                }
                if ((ch === LF && allowBareLF) || (ch === CR && allowBareCR)) {
                    endRecord();
                    i += 1;
                    break;
                }
                if (ch === CR || ch === LF) {
                    if (strict) {
                        throw new SyntaxError("Bare newline is not allowed (use CRLF)");
                    }

                    // 非厳格モードでは、CR単独、LF単独でもレコードの終了としておおめに見てやる
                    endRecord();
                    i += 1;
                    break;
                }
                if (ch === DQ) {
                    if (strict) {
                        // 厳格モードで引用符なしフィールドに引用符が混ざるとNG
                        throw new SyntaxError('Unexpected quote in unquoted field');
                    }
                }
                if (strict && (isControl(ch) && ch !== "\t")) {
                    // 厳格モードで、TAB以外の制御文字の場合
                    //   TABは許容。RFCではC0制御文字は禁止されている。
                    throw new SyntaxError('Control char not allowed in unquoted field');
                }

                // 今から引用符なしフィールドの内部
                state = STATE.IN_FIELD;
                field += ch;
                i += 1;
                break;
            }

            case STATE.IN_FIELD: {
                if (ch === COMMA) {
                    endField();
                    state = STATE.START_FIELD;
                    i += 1;
                    break;
                }
                if (hasCRLF) {
                    endRecord();
                    state = STATE.START_FIELD;
                    i += 2;
                    break;
                }
                if ((ch === LF && allowBareLF) || (ch === CR && allowBareCR)) {
                    endRecord();
                    state = STATE.START_FIELD;
                    i += 1;
                    break;
                }
                if (ch === DQ) {
                    if (strict) {
                        throw new SyntaxError('Quote inside unquoted field');
                    }
                    // 非厳格モードの場合は、引用符はデータとして扱う
                }
                if (strict && (ch === CR || ch === LF || ch === DQ)) {
                    // 厳格モードでは、引用符なしフィールドにCR、LF、DQを含めることはできない
                    throw new SyntaxError('Illegal character in unquoted field');
                }
                if (strict && (isControl(ch) && ch !== "\t")) {
                    // 厳格モードでは、TAB以外の制御文字は使えない
                    throw new SyntaxError('Control char not allowed in unquoted field');
                }

                field += ch;
                i += 1;
                break;
            }

            case STATE.IN_QUOTED: {
                if (ch === DQ) {
                    // 引用符付きフィールドの中で引用符が出現、すなわち、以下の可能性
                    // 　・エスケープされた引用符
                    // 　・引用符付き付きフィールドの終了
                    state = STATE.AFTER_QUOTE;
                    i += 1;
                } else {
                    // 引用符の中では、CR、LF、カンマを含む任意の文字がOK
                    field += ch;
                    i += 1;
                }
                break;
            }

            case STATE.AFTER_QUOTE: {
                if (ch === DQ) {
                    // エスケープされた引用符だった
                    field += DQ;
                    state = STATE.IN_QUOTED;
                    i += 1;
                    break;
                }
                if (ch === COMMA) {
                    endField();
                    state = STATE.START_FIELD;
                    i += 1;
                    break;
                }
                if (hasCRLF) {
                    endRecord();
                    state = STATE.START_FIELD;
                    i += 2;
                    break;
                }
                if ((ch === LF && allowBareLF) || (ch === CR && allowBareCR)) {
                    endRecord();
                    state = STATE.START_FIELD;
                    i += 1;
                    break;
                }
                // 閉じ引用符の後に出現するDQ、カンマ、CR、LFは、RFC4180によれば不正
                if (strict) {
                    throw new SyntaxError('Invalid character after closing quote');
                } else {
                    // 非厳格モードでは、引用符なしフィールドの末尾として扱う
                    state = STATE.IN_FIELD;
                    field += ch;
                    i += 1;
                }
                break;
            }
        }
    }

    // EOFの取り扱い
    switch (state) {
        case STATE.IN_QUOTED:
            // 引用符付きフィールドの中身、すなわち、引用符が閉じてない場合
            if (strict){
                // 厳格モードではエラーにする
                throw new SyntaxError('Unterminated quoted field');
            }
            // 非厳格モードでは、ファイル末尾と同時に引用符付きフィールドも終わるとみなす
            endField();
            rows.push(row);
            break;

        case STATE.AFTER_QUOTE:
        case STATE.IN_FIELD:
        case STATE.START_FIELD:
            // 何か残りのデータがあれば、最後のデータとして採用
            if (field !== "" || row.length > 0) {
                endField();
                rows.push(row);
            }
            break;
    }

    return rows;
}

/* ---------------------------
   Example
----------------------------*/
const csv = [
   'city,name,comment'
  ,'"東京","山田, 太郎","彼は""優秀""です\\n改行もOK"'
  ,'大阪,佐藤,"item1\r\nitem2"'
  ,'福岡,,空のフィールド'
].join('\r\n');

console.log(parseCSV(csv, { strict: false, allowBareLF: false, allowBareCR: false }));
