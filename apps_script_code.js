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

// ★ 보안을 위해 스크립트 속성(PropertiesService)에서 값을 읽어옵니다.
// [설정 방법]: 구글 앱스 스크립트 설정(톱니바퀴 아이콘) -> 스크립트 속성에서 
// 'API_SECRET'과 'ADMIN_PW'를 직접 추가해주시면 됩니다.
const props        = PropertiesService.getScriptProperties();
const API_SECRET   = props.getProperty('API_SECRET') || 'PLEASE_SET_IN_PROPERTIES';
const ADMIN_PW     = props.getProperty('ADMIN_PW')   || 'PLEASE_SET_IN_PROPERTIES';

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

    // 7) 사진 삭제 (단일 및 다중)
    if (data.action === 'deletePhoto' || data.action === 'deletePhotos') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      return handleDeletePhotos(data);
    }

    // 8) 개인 비밀번호 일괄 변경 (촬영자 기준)
    if (data.action === 'updateUserPassword') {
      if ((data.key || '') !== API_SECRET) return unauthorizedResponse();
      return handleUpdateUserPassword(data);
    }

    return jsonResponse({ success: false, error: '알 수 없는 요청입니다.' });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// GET 요청 처리 (POST 리다이렉트 대응 및 안정성 확보)
// GET 요청 처리 (POST 리다이렉트 및 모바일 호환성 대응)
function doGet(e) {
  if (e.parameter && e.parameter.action) {
    return doPost(e);
  }
  return ContentService.createTextOutput('Field Photo API (v2): 정상 작동 중');
}

// ── 머릿글 자동 생성 ─────────────────────────────────────────
// ── 머릿글 자동 생성 ─────────────────────────────────────────
const HEADERS = ['촬영일시', '제목(업체명)', '촬영자', '위도', '경도', '주소', '사진URL', '사진파일ID', '메모', '파일명', '이메일', '비밀번호'];

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

  // 시트에 메타데이터 기록 (12열)
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
    data.email || '',                    // K: 이메일
    data.userPw || data.password || ''   // L: 비밀번호
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

  const values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
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
    email:        String(row[10] || ''),
    userPw:       String(row[11] || '')
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

// ── 내 사진 조회 (촬영자 이름 + 비밀번호로 필터) ───────────────
function handleGetMyPhotos(data) {
  const photographer = (data.photographer || '').trim();
  const userPw = (data.userPw || data.password || data.pw || '').trim();
  if (!photographer) return jsonResponse({ success: false, error: '촬영자 이름이 필요합니다.' });
  if (!userPw) return jsonResponse({ success: false, error: '비밀번호가 필요합니다.' });

  const sheet = getSheet();
  if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ success: true, data: [], total: 0 });

  const values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  const records = [];
  for (let idx = 0; idx < values.length; idx++) {
    const row = values[idx];
    const rowPhotographer = String(row[2] || '').trim();
    const rowUserPw = String(row[11] || '').trim();
    const rowEmail = String(row[10] || '').trim();
    // 촬영자 이름이 일치하고, (비밀번호가 일치하거나 기존에 비밀번호가 없던 행)인 경우 포함
    if (rowPhotographer === photographer && (!rowUserPw || rowUserPw === userPw)) {
      const photoUrl = String(row[6] || '');
      if (!photoUrl) continue;

      // 기존에 비밀번호가 비어있었던 행이면 새 비밀번호로 자동으로 업데이트해줌
      if (!rowUserPw && userPw) {
        try {
          sheet.getRange(idx + 2, 12).setValue(userPw);
        } catch (e) {
          console.warn('Auto set userPw failed:', e);
        }
      }

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
        email:        rowEmail,
        userPw:       userPw
      });
    }
  }

  records.reverse(); // 최신순
  return jsonResponse({ success: true, data: records, total: records.length });
}

// ── 개인 비밀번호 일괄 변경 (촬영자 이름 기준 - 기존 비번 검증 포함) ───────────────
function handleUpdateUserPassword(data) {
  const photographer = (data.photographer || '').trim();
  const oldPw = (data.oldPw || '').trim();
  const newPw = (data.newPw || '').trim();

  if (!photographer) return jsonResponse({ success: false, error: '촬영자 이름이 필요합니다.' });
  if (!newPw) return jsonResponse({ success: false, error: '새 비밀번호를 입력해주세요.' });

  const sheet = getSheet();
  if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ success: true, updatedCount: 0 });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const range = sheet.getRange(2, 1, lastRow - 1, 12);
    const values = range.getValues();

    // 해당 촬영자의 기존 비밀번호 목록 확인
    let existingPws = new Set();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][2] || '').trim() === photographer) {
        const pw = String(values[i][11] || '').trim();
        if (pw) existingPws.add(pw);
      }
    }

    // 1) 입력한 newPw가 이미 시트에 저장되어 있던 비밀번호와 같다면 바로 성공 처리
    if (existingPws.has(newPw)) {
      let fillCount = 0;
      for (let i = 0; i < values.length; i++) {
        if (String(values[i][2] || '').trim() === photographer && !String(values[i][11] || '').trim()) {
          sheet.getRange(i + 2, 12).setValue(newPw);
          fillCount++;
        }
      }
      SpreadsheetApp.flush();
      return jsonResponse({ success: true, updatedCount: fillCount });
    }

    // 2) 기존 비밀번호가 존재하는 계정인데, 이전 비밀번호(oldPw)가 틀리면 변경 거부
    if (existingPws.size > 0 && oldPw && !existingPws.has(oldPw)) {
      return jsonResponse({ success: false, error: '기존 비밀번호가 일치하지 않습니다.' });
    }

    // 3) 비밀번호 업데이트 진행
    let updatedCount = 0;
    for (let i = 0; i < values.length; i++) {
      const rowPhotographer = String(values[i][2] || '').trim();
      const rowPw = String(values[i][11] || '').trim();

      if (rowPhotographer === photographer && (!rowPw || rowPw === oldPw || existingPws.size === 0 || !oldPw)) {
        sheet.getRange(i + 2, 12).setValue(newPw);
        updatedCount++;
      }
    }
    SpreadsheetApp.flush();
    return jsonResponse({ success: true, updatedCount: updatedCount });
  } catch (err) {
    console.error('Update Password Error:', err.toString());
    return jsonResponse({ success: false, error: '비밀번호 변경 오류: ' + err.toString() });
  } finally {
    lock.releaseLock();
  }
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
    lock.waitLock(15000);
    
    if (!data.fileId) return jsonResponse({ success: false, error: '파일 ID가 누락되었습니다.' });
    
    const sheet = getSheet();
    if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    
    // 헤더에서 정확한 인덱스 찾기 (유연하게 찾도록 개선)
    const fileIdIdx = headers.findIndex(h => String(h).includes('ID') || String(h).includes('id'));
    const memoIdx = headers.indexOf('메모');
    
    if (fileIdIdx === -1 || memoIdx === -1) {
      throw new Error('시트에서 사진 ID 또는 메모 컬럼을 찾을 수 없습니다. (현재 헤더: ' + headers.join(',') + ')');
    }

    let targetRow = -1;
    const searchId = String(data.fileId).trim();

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][fileIdIdx]).trim() === searchId) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      return jsonResponse({ success: false, error: '시트에서 해당 사진 정보를 찾을 수 없습니다.' });
    }

    // 메모 업데이트 (정확한 컬럼 위치에 기록)
    const targetValue = data.memo || '';
    sheet.getRange(targetRow, memoIdx + 1).setValue(targetValue);
    SpreadsheetApp.flush();
    
    // 이중 확인 (검증)
    const verifyValue = sheet.getRange(targetRow, memoIdx + 1).getValue();
    if (String(verifyValue) !== String(targetValue)) {
      throw new Error('데이터 검증 실패: 시트에 기록된 값(' + verifyValue + ')이 요청한 값과 다릅니다.');
    }
    
    return jsonResponse({ success: true });
    
  } catch (err) {
    console.error('Update Memo Error:', err.toString());
    return jsonResponse({ success: false, error: '메모 업데이트 오류: ' + err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ── 사진 삭제 (단일 및 다중 지원) ───────────────────────────────
function handleDeletePhoto(data) {
  return handleDeletePhotos(data);
}

function handleDeletePhotos(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    
    let fileIds = data.fileIds;
    if (!fileIds && data.fileId) fileIds = [data.fileId];
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return jsonResponse({ success: false, error: '삭제할 파일 ID가 없습니다.' });
    }
    
    const idSet = new Set(fileIds.map(function(id) { return String(id).trim(); }));

    // 1) 구글 드라이브에서 파일들 삭제 (휴지통 이동)
    fileIds.forEach(function(fId) {
      try {
        var file = DriveApp.getFileById(fId);
        file.setTrashed(true);
      } catch (fErr) {
        console.warn('Drive file delete warning:', fId, fErr.toString());
      }
    });

    // 2) 구글 시트에서 해당 행들 삭제 (역순 행 삭제로 인덱스 뒤틀림 방지)
    const sheet = getSheet();
    if (!sheet) return jsonResponse({ success: false, error: '시트를 찾을 수 없습니다.' });

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const fileIdIdx = headers.findIndex(function(h) {
      return String(h).includes('ID') || String(h).includes('id');
    });

    if (fileIdIdx !== -1) {
      for (let i = rows.length - 1; i >= 1; i--) {
        const rowFileId = String(rows[i][fileIdIdx]).trim();
        if (idSet.has(rowFileId)) {
          sheet.deleteRow(i + 1);
        }
      }
      SpreadsheetApp.flush();
    }
    
    return jsonResponse({ success: true, count: fileIds.length });
    
  } catch (err) {
    console.error('Delete Photos Error:', err.toString());
    return jsonResponse({ success: false, error: '사진 삭제 오류: ' + err.toString() });
  } finally {
    lock.releaseLock();
  }
}
