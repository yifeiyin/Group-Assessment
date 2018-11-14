function collect_result_main_test() {
  /*prepareConstants();
  loadMemberList(workingSpreadsheetName);
  collectResults();
  
  for (var i = 0; i < evaluationEntries.length; i++) {
    debug("");
    for (p in evaluationEntries[i]) {
      debug(String(p) + ": " + JSON.stringify(evaluationEntries[i][p]));
    }
  }
  saveEvaluationEntries(fileName);
  */
  
  var fileName = "Evaluation Entries";
  loadEvaluationEntries(fileName);
  saveEvaluationEntries("evaluation entries 2");

  
  info("Script is about to be terminated.");
}

var evaluationEntries = [];

var MEMBER_E_LEADER = "Member Evaluates Leader";
var LEADER_E_MEMBER = "Leader Evaluates Member";

var YES = "Yes";
var NO = "No";

function collectResults() {
  generateEvaluationEntries();
  
  //assert(resultStats.totalFormsCount - resultStats.noResponseCount == evaluationEntries.length, "Responses collected should equal to evaluation entries length");
  


}

function saveEvaluationEntries(fileName) {
  assert(evaluationEntries.length > 0, "evaluationEntries is empty!");
  
  var sheet = findOrCreateSpreadsheet(fileName).getSheets()[0];
  sheet.clearContents();
  
  var properties = [];
  for (var property in evaluationEntries[0])
    properties.push(property);
  sheet.appendRow(properties);
  
  for (var i = 0; i < evaluationEntries.length; i++) {
    var rowToAppend = [];
    for (var j = 0; j < properties.length; j++)
      rowToAppend.push(JSON.stringify(evaluationEntries[i][properties[j]]));
    sheet.appendRow(rowToAppend);
  }
}

function loadEvaluationEntries(fileName) {
  var sheet = openSpreadsheet(fileName).getSheets()[0];
  var values = sheet.getDataRange().getDisplayValues();
  
  var properties = [];
  for (var col = 0; col < values[0].length; col++) 
    properties.push(values[0][col]);
  
  for (var row = 1; row < values.length; row++) {
    var evaluationEntry = {};
    
    for (var col = 0; col < properties.length; col++)
      evaluationEntry[properties[col]] = JSON.parse(values[row][col]);
    
    evaluationEntries.push(evaluationEntry);
  }
}


function generateEvaluationEntries() {
  
  /********** Structure for evaluationEntry ***************
  .timestamp           // Date, the timeStamp of the response
  .teamName            // String, name of the team the person is in 
                       // (at this point, we assume that we can only evaluate persons in the same team)
  .evaluationBy        // String, name of the person filing the response
  .evaluationFor       // String, name of the person being evaluated
  .evaluationType      // MEMBER_E_LEADER or LEDAER_E_MEMBER
  .evaluations         // dictionary, aspect to rating (aspect: the category, rating: the mark)
  .comment             // String, correspond to the comment section in the form
  **********************************************************/
  
  /******** NOTES 2 ON THE BEHAVIOUR OF FORM RESPONSES ********
  For the forms sent to leaders, they have an optional section called "bonus". 
  If none of the boxes are checked, it will not be a apart of the "response", 
  therefore, we need to check if bonus section has been skipped or not.
  
  However, "additonal information" section, aka "comments" section,
  although it is optional too, it is not skipped. If the respondent does not fill
  anything, the result will be an empty string.
  **********************************************************/

  
  for (var iMember = 0; iMember < memberList.length; iMember++) {
    // Check for if the program is in recover mode (which is indicated by a not-undefined value in that property)
    if (PropertiesService.getScriptProperties().getProperty("collect-results.generateEvaluationEntries.nextIMemberValue") != undefined) {
      iMember = PropertiesService.getScriptProperties().getProperty("collect-results.generateEvaluationEntries.nextIMemberValue");
      PropertiesService.getScriptProperties().setProperty("collect-results.generateEvaluationEntries.nextIMemberValue", undefined);
    }
    // If time is almost up, set the property to a not-undefined value.
    if (_isTimeAlmostUp()) {
      var nextIMemberValue = iMember;
      PropertiesService.getScriptProperties().setProperty("collect-results.generateEvaluationEntries.nextIMemberValue", nextIMemberValue);
      throw "Time is almost up.";
    }
    
    var member = memberList[iMember];
    
    for (var iRole = 0; iRole < member.roles.length; iRole++) {
      var role = member.roles[iRole];
      var link = role.link;
      if (link == undefined || link == "" || startsWithHash(link)) {
        continue;
      }
      
      var formId = role.formId;
      assert(formId != "" && formId != undefined, "Unexpected formId: " + String(formId));
      
      var form = FormApp.openById(formId);
      var responses = form.getResponses();
      responses.sort(function(a, b) {return b.getTimestamp() - a.getTimestamp()});
      var latestResponse = responses[0];
      if (latestResponse == undefined) {
        info(quotes(member.name) + ", " + role.position + " of " + role.teamName + " does not have a response.");
        continue;
      }
      
      var itemResponses = latestResponse.getItemResponses();
      info(quotes(member.name) + ", " + role.position + " of " + role.teamName + " is about to be processed.");
      
      var teamName = role.teamName;
      var evaluatedBy = member.name;
      var timestamp = latestResponse.getTimestamp();

      // We have got the latestResponse. Depending on its position, we will create the evaluationEntry repectively.
      if (role.position == "Member") {
        _generateEvaluationEntryForMember(member, role, itemResponses, teamName, evaluatedBy, timestamp);
      
      } else if (role.position == "Leader") {
        _generateEvaluationEntryForLeader(member, role, itemResponses, teamName, evaluatedBy, timestamp);
      }
    }
  }
}


/***** NOTES 3 Pseudo Code For the hasBonus Section *******
* Declare bonuses As Dictionary.
* for currentMemberName in memberNamesOfThisTeam:
*     if hasBonusSection and currentMemberName is in bonusSectionResponse:
*        bonuses[currentMemberName] = YES.
*     else:
*        bonuses[currentMemberName] = NO.
***********************************************************/

function _generateEvaluationEntryForLeader(member, role, itemResponses, teamName, evaluatedBy, timestamp) {
  // We expect that the leader will rate for each of its members.
  // Refer _generateFormContentForMember in generate-forms.gs for the structure of the form
  
  // Test if the second last section's title is Bonus, if so, it means there is a bonus section, deal with it first.
  var hasBonusSection = itemResponses[itemResponses.length - 2].getItem().getTitle() == "Bonus";
  var bonusSectionResponse = undefined;
  if (hasBonusSection) { bonusSectionResponse = itemResponses[itemResponses.length - 2]; }
  
  var bonuses = {};
  
  for (var i = 0; i < teamList[teamName].members.length; i++) {
    // See NOTES 3 (before this chunk of code) for explanations
    var currentMemberName = teamList[teamName].members[i];
    var hasBonus = NO;
    if (hasBonusSection) {
      for (var iItem = 0; iItem < bonusSectionResponse.getResponse().length; iItem++)
        if (currentMemberName == bonusSectionResponse[iItem])
          hasBonus = YES;
    }
    bonuses[currentMemberName] = hasBonus;
  }
  
  var _iMax = itemResponses.length - 1;
  if (hasBonus) { _iMax--; }
  
  // Looping through every sections in the response, which are the evaluations for the corresponding member
  for (var i = 0; i < _iMax; i++) {
    var evaluatedFor = itemResponses[i].getItem().getTitle();
    assert(teamList[teamName].members.indexOf(evaluatedFor) >= 0, "Unexpected team member name, not in memberList: " + evaluatedFor);
    
    var evaluations = {};
    var rawEvaluations = itemResponses[i].getResponse();
    
    assert(evaluationAspectsForMembers.length == rawEvaluations.length, "evaluationAspectsForMembers.length == rawEvaluations.length, rawEvaluations.length = " + JSON.stringify(rawEvaluations));
    for (var j = 0; j < rawEvaluations.length; j++) {
      evaluations[evaluationAspectsForMembers[j]] = rawEvaluations[j];
    }
    evaluations['bonus'] = bonuses[currentMemberName];
    
    var comment;
    if (itemResponses[itemResponses.length - 1] == undefined) {
      comment = "";
    } else {
      comment = itemResponses[itemResponses.length - 1].getResponse();
    }
    
    var evaluationEntry = {};
    evaluationEntry.timestamp = timestamp;
    evaluationEntry.teamName = teamName;
    evaluationEntry.evaluationType = LEADER_E_MEMBER;
    evaluationEntry.evaluatedBy = evaluatedBy;
    evaluationEntry.evaluatedFor = evaluatedFor;
    evaluationEntry.evaluations = evaluations;
    evaluationEntry.comment = comment;
    evaluationEntries.push(evaluationEntry);
  }
}

function _generateEvaluationEntryForMember(member, role, itemResponses, teamName, evaluatedBy, timestamp) {
  // We expect that the member will rate for its leader.
  // Refer _generateFormContentForLeader in generate-forms.gs for the structure of the form
  var evaluatedFor = itemResponses[0].getItem().getTitle();
  assert(teamList[teamName].leaders.indexOf(evaluatedFor) >= 0, "Unexpected team leader name, not in memberList: " + evaluatedFor);
  
  var evaluations = {};
  var rawEvaluations = itemResponses[0].getResponse();
  assert(evaluationAspectsForMembers.length == rawEvaluations.length, "evaluationAspectsForMembers.length == rawEvaluations.length");
  for (var i = 0; i < evaluationAspectsForMembers.length; i++) {
    evaluations[evaluationAspectsForMembers[i]] = rawEvaluations[i];
  }
  
  var comment;
  if (itemResponses[1] == undefined) {
    comment = "";
  } else {
    comment = itemResponses[1].getResponse();
  }
  
  
  var evaluationEntry = {};
  evaluationEntry.timestamp = timestamp;
  evaluationEntry.teamName = teamName;
  evaluationEntry.evaluationType = MEMBER_E_LEADER;
  evaluationEntry.evaluatedBy = evaluatedBy;
  evaluationEntry.evaluatedFor = evaluatedFor;
  evaluationEntry.evaluations = evaluations;
  evaluationEntry.comment = comment;
  evaluationEntries.push(evaluationEntry);
}
