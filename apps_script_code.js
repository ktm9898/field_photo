/**
 * ============================================================
 *  상권 현장방문 사진 관리 - Google Apps Script 백엔드
 * ============================================================
 *
 *  [구글 시트 헤더 (A1~J1)]
 *  촬영일시 | 촬영자 | 업체번호 | 위도 | 경도 | 주소 | 사진URL | 사진파일ID | 메모 | 파일명
 *
 *  [설정 방법]
 *  1. 구글 시트 새로 만들기 → 확장 프로그램 > Apps Script
 *  2. 이 코드 전체 붙여넣기
 *  3. SPREADSHEET_ID, DRIVE_FOLDER_ID 설정
 *  4. 배포 > 새 배포 > 웹앱 > 액세스: 모든 사용자
 *  5. URL을 index.html, admin.html에 붙여넣기
 * ============================================================
 */

// ── 설정 ───────────────────────────────────────────────────
const SHEET_NAME   = 'Sheet1';
const API_SECRET   = 'FieldPhoto2026!';        // index.html, admin.html 코드와 동일하게 유지
const ADMIN_PW     = '2082';                   // 관리자 페이지 비밀번호

// ★ 아래 두 값을 본인 환경에 맞게 수정하세요
const SPREADSHEET_ID  = '';  // 구글 시트 URL에서 /d/ 뒤에 오는 긴 ID 값
const DRIVE_FOLDER_ID = '';  // 구글 드라이브 폴더 URL에서 /folders/ 뒤 ID 값

// ── 헬퍼 ───────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function unauthorizedResponse() {
  return jsonResponse({ success: false, error: '잘못된 API 키입니다.' });
}

function getSheet() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME);
}

function getRootFolder() {
  return DRIVE_FOLDER_ID
    ? DriveApp.getFolderById(DRIVE_FOLDER_ID)
    : DriveApp.getRootFolder();
}

/**
 * 날짜 문자열에 해당하는 서브폴더를 가져오거나 만들어 반환
 * 예: 현장사진/2026-04-19/
 */
function getDateFolder(dateStr) {
  const root = getRootFolder();
  // 현장사진 폴더
  let parentFolder;
  const parentIter = root.getFoldersByName('현장사진');
  if (parentIter.hasNext()) {
    parentFolder = parentIter.next();
  } else {
    parentFolder = root.createFolder('현장사진');
  }
  // 날짜 서브폴더
  const subIter = parentFolder.getFoldersByName(dateStr);
  if (subIter.hasNext()) {
    return subIter.next();
  }
  return parentFolder.createFolder(dateStr);
}

function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateTime(d) {
  // 한국표준시(KST = UTC+9) 기준 한글 날짜 형식
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${y}년 ${mo}월 ${day}일 ${ampm} ${h12}:${min}`;
}

// ── doPost ─────────────────────────────────────────────────
function doPost(e) {
  try {
    // 1) 데이터 추출 (JSON 또는 Parameter)
    let data;
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch(ex) {
        data = e.parameter;
      }
    } else {
      data = e.parameter;
    }

    // 1) 관리자 조회 요청
    if (data.action === 'getAll') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      if (data.pw !== ADMIN_PW) return jsonResponse({ success: false, error: '비밀번호가 틀렸습니다.' });
      return handleGetAll();
    }

    // 2) 사진 업로드
    if (data.action === 'upload') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      return handleUpload(data);
    }

    // 3) 메일 발송
    if (data.action === 'sendEmail') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      // 이메일 발송은 별도의 비밀번호 체크 (필요시)
      return handleSendEmail(data);
    }
    
    // 5) 파일 데이터 Base64 요청 (다운로드 중계)
    if (data.action === 'getFileBase64') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      return handleGetFileBase64(data);
    }

    // 4) 내 사진 조회 (촬영자 이름 + 이메일로 필터)
    if (data.action === 'getMyPhotos') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      return handleGetMyPhotos(data);
    }

    // 6) 메모 업데이트
    if (data.action === 'updateMemo') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      return handleUpdateMemo(data);
    }

    return jsonResponse({ success: false, error: '알 수 없는 요청입니다.' });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// GET 차단
function doGet() {
  return ContentService.createTextOutput('접근이 거부되었습니다.');
}

// ── 머릿글 자동 생성 ─────────────────────────────────────────
const HEADERS = ['촬영일시', '제목(업체명)', '촬영자', '위도', '경도', '주소', '사진URL', '사진파일ID', '메모', '파일명', '이메일'];

function ensureHeaders(sheet) {
  // 시트가 완전히 비어 있을 때만 머릿글 추가
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    // 머릿글 스타일 (굵게 + 배경색)
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1e293b');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');
  }
}

// ── 사진 업로드 처리 ─────────────────────────────────────────
function handleUpload(data) {
  const sheet = getSheet();
  if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

  // 머릿글 없으면 자동 생성
  ensureHeaders(sheet);

  const now = new Date();
  const dateStr    = formatDateStr(now);
  const datetimeStr = formatDateTime(now);

  // Base64 → Blob → 드라이브 저장
  const base64Image = data.imageBase64 || '';
  if (!base64Image) return jsonResponse({ success: false, error: '이미지 데이터가 없습니다.' });

  // 파일명 생성: {업체번호}_{timestamp}.jpg
  const bizNum  = (data.bizNumber || 'unknown').replace(/[^a-zA-Z0-9가-힣]/g, '_');
  const ts      = now.getTime();
  const mime    = data.mimeType || 'image/jpeg';
  const ext     = mime.includes('png') ? 'png' : 'jpg';
  const fileName = `${bizNum}_${ts}.${ext}`;

  // 드라이브 폴더 → 파일 저장
  const folder   = getDateFolder(dateStr);
  const blob     = Utilities.newBlob(
    Utilities.base64Decode(base64Image.replace(/^data:image\/\w+;base64,/, '')),
    mime,
    fileName
  );
  const file = folder.createFile(blob);

  // 파일 공유 설정 (링크 보기 권한)
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId  = file.getId();
  const fileUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

  // 시트에 메타데이터 기록 (11열)
  sheet.appendRow([
    datetimeStr,                         // A: 촬영일시
    data.bizNumber || '',                // B: 업체번호
    data.photographer || '',             // C: 촬영자
    data.lat || '',                      // D: 위도
    data.lng || '',                      // E: 경도
    data.address || '',                  // F: 주소
    fileUrl,                             // G: 사진URL
    fileId,                              // H: 사진파일ID
    data.memo || '',                     // I: 메모
    fileName,                            // J: 파일명
    data.email || ''                     // K: 이메일
  ]);

  return jsonResponse({
    success: true,
    fileUrl: fileUrl,
    fileId:  fileId,
    fileName: fileName
  });
}

// ── 전체 데이터 조회 ─────────────────────────────────────────
function handleGetAll() {
  const sheet = getSheet();
  if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ success: true, data: [], total: 0 });

  const values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  const records = values.map((row, idx) => ({
    rowIndex:     idx + 2,
    datetime:     row[0] ? String(row[0]) : '',
    bizNumber:    String(row[1] || ''),
    photographer: String(row[2] || ''),
    lat:          row[3] !== '' ? Number(row[3]) : null,
    lng:          row[4] !== '' ? Number(row[4]) : null,
    address:      String(row[5] || ''),
    photoUrl:     String(row[6] || ''),
    fileId:       String(row[7] || ''),
    memo:         String(row[8] || ''),
    fileName:     String(row[9] || ''),
    email:        String(row[10] || '')
  })).filter(r => r.photoUrl); // URL 없는 행 제외

  records.reverse(); // 최신순
  return jsonResponse({ success: true, data: records, total: records.length });
}

// ── 이메일 전송 ──────────────────────────────────────────────
function handleSendEmail(data) {
  if (!data.email) return jsonResponse({ success: false, error: '수신 이메일 정보가 없습니다.' });
  if (!data.fileIds || !data.fileIds.length) return jsonResponse({ success: false, error: '첨부할 파일 식별자가 없습니다.' });

  const attachments = [];
  try {
    for (let i = 0; i < data.fileIds.length; i++) {
        const fId = data.fileIds[i];
        const file = DriveApp.getFileById(fId);
        attachments.push(file.getBlob());
    }
  } catch (err) {
      return jsonResponse({ success: false, error: '파일을 드라이브에서 가져오는 중 오류가 발생했습니다. ' + err.toString() });
  }

  const htmlBody = `
    <h2>상권 현장 방문 사진</h2>
    <p><b>제목(업체명):</b> ${data.bizNumber || '-'}</p>
    <p>총 <b>${attachments.length}</b>장의 사진이 첨부되었습니다.</p>
  `;

  try {
    MailApp.sendEmail({
      to: data.email,
      subject: `[현장사진] ${data.bizNumber} 현장점검 결과`,
      htmlBody: htmlBody,
      attachments: attachments
    });
  } catch (err) {
    if (err.toString().includes('Exceeded maximum execution time') || err.toString().includes('Limit Exceeded') || err.toString().includes('too large')) {
      return jsonResponse({ success: false, error: '사진들의 총 용량이 25MB 이메일 첨부 제한을 초과했습니다.' });
    }
    return jsonResponse({ success: false, error: '메일 발송 중 오류: ' + err.toString() });
  }

  return jsonResponse({ success: true });
}

// ── 내 사진 조회 (촬영자 이름 + 이메일로 필터) ───────────────
function handleGetMyPhotos(data) {
  const photographer = (data.photographer || '').trim();
  const email = (data.email || '').trim();
  if (!photographer) return jsonResponse({ success: false, error: '촬영자 이름이 필요합니다.' });

  const sheet = getSheet();
  if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ success: true, data: [], total: 0 });

  const values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  const records = [];
  for (let idx = 0; idx < values.length; idx++) {
    const row = values[idx];
    const rowPhotographer = String(row[2] || '').trim();
    const rowEmail = String(row[10] || '').trim();
    // 촬영자 이름과 이메일이 모두 일치하는 경우에만 포함 (보안 강화)
    if (rowPhotographer === photographer && rowEmail === email) {
      const photoUrl = String(row[6] || '');
      if (!photoUrl) continue;
      records.push({
        datetime:     row[0] ? String(row[0]) : '',
        bizNumber:    String(row[1] || ''),
        photographer: rowPhotographer,
        lat:          row[3] !== '' ? Number(row[3]) : null,
        lng:          row[4] !== '' ? Number(row[4]) : null,
        address:      String(row[5] || ''),
        photoUrl:     photoUrl,
        fileId:       String(row[7] || ''),
        memo:         String(row[8] || ''),
        fileName:     String(row[9] || ''),
        email:        rowEmail
      });
    }
  }

  return jsonResponse({ success: true, data: records, total: records.length });
}

// ── 파일 데이터를 Base64로 가져오기 (다운로드용 중계) ────────
function handleGetFileBase64(data) {
  if (!data.fileId) return jsonResponse({ success: false, error: '파일 ID가 없습니다.' });
  try {
    const file = DriveApp.getFileById(data.fileId);
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    return jsonResponse({ 
      success: true, 
      base64: base64, 
      mimeType: blob.getContentType(),
      fileName: file.getName()
    });
  } catch (err) {
    return jsonResponse({ success: false, error: '파일을 읽는 중 오류 발생: ' + err.toString() });
  }
}

// ── 메모 업데이트 ───────────────────────────────────────────
function handleUpdateMemo(data) {
  const lock = LockService.getScriptLock();
  try {
    // 최대 10초간 잠금 대기 (다른 작업과 충돌 방지)
    lock.waitLock(10000);
    
    if (!data.fileId) return jsonResponse({ success: false, error: '파일 ID가 없습니다.' });
    
    const sheet = getSheet();
    if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonResponse({ success: false, error: '데이터가 없습니다.' });

    // 파일 ID로 해당 행 찾기 (H열 = 8번 인덱스)
    const range = sheet.getRange(2, 8, lastRow - 1, 1);
    const values = range.getValues();
    let targetRow = -1;

    const searchId = String(data.fileId).trim();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0]).trim() === searchId) {
        targetRow = i + 2;
        break;
      }
    }

    if (targetRow === -1) {
      return jsonResponse({ success: false, error: '해당 파일을 시트에서 찾을 수 없습니다.' });
    }

    // 메모 업데이트 (I열 = 9번 인덱스)
    sheet.getRange(targetRow, 9).setValue(data.memo || '');
    
    // 변경사항 즉시 반영
    SpreadsheetApp.flush();
    
    return jsonResponse({ success: true });
    
  } catch (err) {
    return jsonResponse({ success: false, error: '메모 업데이트 중 오류: ' + err.toString() });
  } finally {
    lock.releaseLock();
  }
}
