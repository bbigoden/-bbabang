/**
 * 네이버예약 알림 메일 → 부소장 '확인 필요'
 *
 * 꽃집용 지메일에서 돌린다. 이예리 씨 네이버 메일이 예약 알림을 이 지메일로 자동 전달하면,
 * 5분마다 새 메일을 찾아 부소장에 넘기고 '부소장전달' 라벨을 붙인다(다시 안 보냄).
 * 네이버예약 메일이 아닌 건 부소장이 알아서 거른다.
 *
 * 붙이는 법
 *  1. 그 지메일로 로그인한 채 script.google.com → 새 프로젝트 → 이 내용을 통째로 붙여넣기
 *  2. 아래 URL 을 부소장에게 받은 주소로 바꾸기
 *  3. 위쪽 함수 고르는 칸에서 setup 을 고르고 [실행] → 권한 허용
 *     (5분마다 도는 예약이 만들어진다. 다시 실행해도 하나만 남는다)
 */

var URL = '여기에_부소장_주소';
var LABEL = '부소장전달';

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  run();
}

function run() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search('newer_than:3d -label:' + LABEL + ' -in:spam -in:trash', 0, 30);
  threads.forEach(function (th) {
    var allOk = true;
    th.getMessages().forEach(function (msg) {
      var res = UrlFetchApp.fetch(URL, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          id: msg.getId(),
          from: msg.getFrom(),
          subject: msg.getSubject(),
          text: msg.getPlainBody(),
          html: msg.getBody(),
        }),
      });
      if (res.getResponseCode() !== 200) {
        allOk = false;
        console.error('부소장 전달 실패 ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
      }
    });
    if (allOk) th.addLabel(label);   // 실패한 건 라벨 없이 두어 5분 뒤 다시 보낸다
  });
}
