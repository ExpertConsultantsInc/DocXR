
'use strict';

import * as THREE from 'three';
import {bc} from "/js/docXR.js";

// TERMS:
// Bond - The definition of the structure of what is wanted in a record definined by the script writers construction of Fields.
// Field - A node in the Bond definition.
// Record - The root Bond object.
// recordMap - one records defined by a map of field/values.
// register - A structure that holds the order of fields.
// gridRecord - A structure {ref:[<index to similar record in source>...], values:[<field value>...]}
class Field extends bc.control.Control {
  ignore = false; visible = true;
  addToRegister(inRegister) {}
  preProcessField() {}
  doFocusWithLockAction(inDesign, inDetail) {
    // Find the first record in the grid that matches the lock.
    let tableCtl = this.parent.parent;
    let recordCtl = this.parent;
    let grid = tableCtl.grid;
    let recordIndex = -1;
    this.lock = inDetail;
    for (let rI = 0, rLen = grid.length; rI < rLen && recordIndex == -1; rI++) {
      let record = grid[rI];
      let found = recordCtl.updateBondWithRecord(record);
      if (found) {recordIndex = rI}
    }
    this.lock = '';
    tableCtl.recordIndex = recordIndex;
  }

  static get definition() {return {name:'Field', type:bc.CLASS, childMap:{
    visible:{type:bc.BOOLEAN, mod:bc.FIELD, default:true, description:'Field is present in output register'},
    ignore:{type:bc.BOOLEAN, mod:bc.FIELD, default:false, description:'Ignore field when rebuilding table'},
    doFocusWithLock:{type:bc.STRING, mod:bc.ACTION, description:'Focus on a record based on lock value given'}
  }}}
}
class FieldLeaf extends Field {
  maxLength = 0;
  known = '';
  lock = '';
  relevant = true;
  addToRegister(inRegister) {
    if (!this.ignore) {inRegister.push(this)}
  }
  findValue(inRecord) {
    let parentValue = this.parent.findValue(inRecord);
    if (parentValue != null) {
      let value = parentValue[this.nickName];
      if (value == null && this.default != null) value = this.default;
      else if (typeof value == 'string') {
        if (value == '' && this.default != null) value = this.default;
        if (this.maxSize) {value = value.substring(0, this.maxSize)}
      }
//      else if (typeof value == 'boolean') {value = value ? 'true' : 'false'}
//      console.log('value:', value);
      return value;
    }
  }
  buildHeader(header) {
    header.push({label:this.id, length:1});
  }
  toJSON(inKey, inJSON, gridRecord) {
    inJSON[inKey] = gridRecord.map[this.nickName];
  }
  toRecordMap(inKey, inRecord) {
    inRecord[inKey] = this.value;
  }
  updateBondWithRecord(inRecord) {
    this.value = this.findValue(inRecord);
    if (this.lock != '') {
      if (this.value != this.lock) {return false}
    }
    return true;
  }
  updateRecordFromBond(record) {
    record.map[this.nickName] = this.value;
    return true;
  }
  get nickName() {return this.name ? this.name : this.id}
  validateFieldValue(inRecord) {
    let data = this.findValue(inRecord);
    // Super hack to check boolean types since false does not work when checking strings.
    if (typeof this.lock == 'boolean') {
//      console.log('id:', this.id, ' is boolean lock:', this.lock, ' data:', data, ' inRecord:', inRecord);
      if (this.lock && data) {return true}
      else if (!this.lock && !data) {return true}
      else {return false}
    }
    else if (this.lock && this.lock != data) {return false}
    if (this.operation || this.default != null) {return true}
    if (data == null || (typeof data == 'string' && data == '')) {return false}
    return true;
  }
  checkKnown(gridRecord, data, initFlag) {
    if (initFlag) {this.known = data; this.isEmpty = true}
    else if (this.known != data) this.known = '';
    if (data != '') this.isEmpty = false;
  }
  get floatValue() {
    return Number(this.value);
  }
  preProcessField() {
    this.maxLength = 0;
    this.relevant = false;
  }
  postProcessField(inRecord, inIndex) {
    let value = inRecord.map[this.nickName];
    if (value) {
      this.relevant = true;
      this.maxLength = value.length > this.maxLength ? value.length : this.maxLength;
      if (this.operation) {
        if (this.operation == 'count') {inRecord.map[this.nickName] = inRecord.ref.length}
      }
    }
    return true;
  }
  static get definition() {return {name:'FieldLeaf', type:bc.CLASS, childMap:{
    default:{type:bc.DATA, mod:bc.FIELD, description:'sets the field value if none is present'},
    name:{type:bc.STRING, mod:bc.FIELD, description:'If set then uses this name instead of the id of the control'},
    lock:{type:bc.STRING, mod:bc.FIELD, description:'Field is only valid if it equals the lock value'},
    isEmpty:{type:bc.BOOLEAN, mod:bc.TRAIT, description:'True if all values for the field are empty in the table'},
    known:{type:bc.STRING, mod:bc.FIELD, description:'If all fields in a table are the same value then known is set to that value'},
    maxSize:{type:bc.INTEGER, mod:bc.FIELD, description:'Maximum size in bytes of the field'},
    operation:{type:bc.STRING, mod:bc.FIELD, description:'If set to add then field values are added when records are the same'},
    merge:{type:bc.INTEGER, mod:bc.FIELD, description:'0 = must be present 1 = overwrite'},
    value:{type:bc.STRING, mod:bc.FIELD, description:'Current value of the field for the focused record'},
    floatValue:{type:bc.FLOAT, mod:bc.TRAIT, description:'Current value of the field as a floating point number'},
    maxLength:{type:bc.INTEGER, mod:bc.TRAIT, description:'Maximum Length of field data found'},
    relevant:{type:bc.BOOLEAN, mod:bc.TRAIT, description:'If all fields are empty then it is not relevant'},
  }, description:'Base class for leaf nodes'}}
}
bc.ControlFactory.newFactory(FieldLeaf);

// Record is used to convey better terminology to the script writer even though
// the underlying type is Field.
class Record extends Field {
  sortGrid(inGrid, inColumn, inRegister) {
    let key = inRegister[inColumn].nickName;
    inGrid.sort((a, b)=>{
      let aV = a.map[key];
      let bV = b.map[key];
      if (bV == aV) {return 0}
      else if (bV <= aV) {return 1}
      else {return -1}
    });
  }
  findValue(inRecord) {return inRecord.map}
  buildValues(inRegister, inRecordMap) {
    let values = new Array(inRegister.length);
    for (let fI = 0, fLen = inRegister.length; fI < fLen; fI++) {
      let field = inRegister[fI];
      values[fI] = inRecordMap[field.nickName];
    }
    return values;
  }
  // Build a grid of potential records from the source.
  async processCandidateRecords(inGrid, inSortColumn, candidates, register) {
    // Preprocess fields.
    for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
      let field = register[fI];
      field.preProcessField();
    }

    // Then Iterate through the records and call onBuild if needed
    let onFormulate = this.parent.onFormulate;
    if (onFormulate) {await this.parent.applyRecordRules(candidates, onFormulate)}
    // Then check records again after onBuild to see if they are still valid.
    for (let aI = 0, aLen = candidates.length; aI < aLen; aI++) {
      let candidateRecord = candidates[aI];
      let isGood = true;

      // Check all fields against candidate record to see if it's valid.
      for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
        let field = register[fI];
        isGood = field.validateFieldValue(candidateRecord);
        if (!isGood) break;
      }
      if (isGood) { // If a record is created from source
        let bValues = this.buildValues(register, candidateRecord.map);
//          let bValues = candidateRecord.values;
        let aValues = null;
        let rI = 0;
        // Manually check each record for sameness.  This can be sped up by sorting records.
        while (rI < inGrid.length) { // Check if record is unique
          aValues = this.buildValues(register, inGrid[rI].map);
//            aValues = inGrid[rI].values;
          let same = 0;
          for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
            let field = register[fI];
            if (field.operation || aValues[fI] == bValues[fI]) same++
          }
          if (same == aValues.length) {break}
          rI++;
        }
        if (rI == inGrid.length) { // If Unique then add to grid
          if (candidateRecord.ref.length == 0) { // If a reference has not been assigend then it must be a new record and tell source.
            await this.parent.source.ref.addNewRecord(candidateRecord);
          }
          inGrid.push(candidateRecord);

          // On first record of the grid reset known values to initial record.
          let initFlag = inGrid.length == 1 ? true : false;
          // Check if knowns are valid.
          for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
            let field = register[fI];
            field.checkKnown(candidateRecord, candidateRecord.map[field.nickName], initFlag);
          }
/*            for (let key in this.childMap) {
            let child = this.childMap[key];
            if (child) {
              child.checkKnown(candidateRecord, candidateRecord.values[child.order], initFlag);
            }
          } */
//            aValues = candidateRecord.values;
        } else { // Otherwise union the records
          for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
            let field = register[fI];
            if (field.operation == 'add') {
              inGrid[rI].map[field.nickName] = Math.round((Number(aValues[fI]) + Number(bValues[fI]))*100)/100
            }
//              else if (field.operation == 'count') {inGrid[rI].map[field.nickName] = Number(aValues[fI]) + Number(bValues[fI])}
          }
          inGrid[rI].ref.push(...candidateRecord.ref);
        }
      }
    }
    // Post process records.  This is used by formulas, add, count operations to allow you to lock on calculated values.
    for (let rI = 0; rI < inGrid.length; rI++) {
      let record = inGrid[rI];
      for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
        let field = register[fI];
        let isGood = field.postProcessField(record, rI);
        if (!isGood) {console.error ('failed record:', record); inGrid.splice(rI--, 1);}
      }
    }
    this.sortGrid(inGrid, inSortColumn, register);
/*      inGrid.sort((a, b)=>{
      let cI = 0;
      while (cI < a.values.length && a.values[cI] == b.values[cI]) cI++;
      if (cI == a.values.length) {return 0}
      else if (b.values[cI] <= a.values[cI]) {return 1} else {return -1}
    }); */
  }
  updateBondWithRecord(record) {
    let valid = true;
    for (let key in this.childMap) {
      let child = this.childMap[key];
      if (child) {
        if (!child.updateBondWithRecord(record)) valid = false;
      }
    }
    return valid;
  }
  updateRecordFromBond(record) {
    let valid = true;
    for (let key in this.childMap) {
      let child = this.childMap[key];
      if (child) {
        if (!child.updateRecordFromBond(record)) valid = false;
      }
    }
    return valid;
  }
  toJSON(inKey, inJSON, grid) {
    let outJSON = [];
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {
      let gridRecord = grid[rI];
      let jSONRecord = {};
      for (let key in this.childMap) {
        let child = this.childMap[key];
        if (child) {
          child.toJSON(key, jSONRecord, gridRecord);
        }
      }
      outJSON.push(jSONRecord);
    }
    inJSON[inKey] = outJSON;
  }
  toRecordMap() {
    let record = {};
    for (let key in this.childMap) {
      let child = this.childMap[key];
      if (child) {
        child.toRecordMap(key, record);
      }
    }
    return record;
  }
  static get definition() {return {name:'Record', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(Record);
class StringField extends FieldLeaf {
  static get definition() {return {name:'StringField', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(StringField);
class NumberField extends FieldLeaf {
  findValue(inRecord) {
    let parentValue = this.parent.findValue(inRecord);
    if (parentValue != null) {
      let value = parentValue[this.nickName];
      if (value == null && this.default != null) value = this.default;
      else if (typeof value == 'string') {
        if (value == '' && this.default != null) value = this.default;
        value = Number(value);
      }
      return value;
    }
  }
  preProcessField() {
    this.maxValue = -0xffffffff;
    this.minValue = -0xffffffff;
    this.maxLength = 0;
    this.relevant = false;
  }
  postProcessField(inRecord, inIndex) {
    let value = this.findValue(inRecord);
    if (value) this.relevant = true;
    let len = value.toString().length;
    this.maxLength = len > this.maxLength ? len : this.maxLength;
    if (value > this.maxValue) this.maxValue = value;
    if (value < this.minValue) this.minValue = value;
    if (this.operation) {
      if (this.operation == 'count') {inRecord.map[this.nickName] = inRecord.ref.length}
    }
    return true;
  }
  static get definition() {return {name:'NumberField', type:bc.CLASS, childMap:{
    minValue:{type:bc.FLOAT, mod:bc.FIELD, description:'Minimum value found in the record set'},
    maxValue:{type:bc.FLOAT, mod:bc.FIELD, description:'Maximum value found in the record set'}
  }}}
}
bc.ControlFactory.newFactory(NumberField);
class ControlField extends FieldLeaf {
  addToRegister(inRegister) {
    if (Object.keys(this.childMap).length == 0) {
      super.addToRegister(inRegister);
    }
    else {
      if (!this.ignore) {
        for (let key in this.childMap) {
          let field = this.childMap[key];
          field.addToRegister(inRegister);
        }
      }
    }
  }
  buildHeader(inHeader) {
    let len = 0;
    for (let fieldKey in this.childMap) {
      let cField = this.childMap[fieldKey];
      len += cField.buildHeader(inHeader);
    }
    return len;
  }
  findValue(inRecord) {
    let parentValue = this.parent.findValue(inRecord);
    if (parentValue instanceof bc.control.Control) parentValue = parentValue.childMap;
    let value = parentValue[this.nickName];
    if (typeof value == 'string') {
      // Hack to get value if it is a path.
      value = this.env.evaluate(this.env, this.env.factory, this.env, [value]).detail;
    }

    return value;
  }
  static get definition() {return {name:'ControlField', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(ControlField);
class DateField extends FieldLeaf {
  get dayString() {return DateField.dayStrings[this.dayIndex]}
  get dayIndex() {let d = new Date(this.value); return d.getDay()}
  static get definition() {return {name:'DateField', type:bc.CLASS, childMap:{
    dayString:{type:bc.STRING, mod:bc.TRAIT},
    dayIndex:{type:bc.STRING, mod:bc.TRAIT}
  }}}
  static get dayStrings() {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  }
}
bc.ControlFactory.newFactory(DateField);
class Source extends bc.control.Control {
  toJSON() {
    let grid = this.grid;
    let json = [];
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {json.push(grid[rI].map)}
    return json;
  }
  // Purge any empty records and return grid;
  async getUpdatedGrid() {
    for (let rI = 0; rI < this.grid.length; rI++) {
      if (this.grid[rI].ref.length == 0) this.grid.splice(rI--, 1);
    }
    return this.grid;
  }
  async addNewRecord(inRecord) {
    inRecord.ref.push(this.grid.length);
    this.grid.push(inRecord);
  }
  doSaveAction(inDesign, inDetail) {}
  doMergeTableAction(inDesign, inTable) {
    console.log('inTable:', inTable);
    let tGrid = this.grid;
    let sGrid = inTable.grid;
    let sRecord = inTable.record;
    let register = [];
    for (let key in sRecord.childMap) {
      let field = sRecord.childMap[key];
      if (!field.ignore) {
        let merge = field.merge ? field.merge : 0;
        register.push({name:field.nickName, merge:merge})
      }
    }
    for (let sI = 0, sLen = sGrid.length; sI < sLen; sI++) {
      let sRecordMap = sGrid[sI].map;
      let isRecordFound = false;
      for (let tI = 0, tLen = tGrid.length; tI < tLen; tI++) {
        let tRecordMap = tGrid[tI].map;
        let validCount = 0;
        for (let rI = 0, rLen = register.length; rI < rLen; rI++) {
          let field = register[rI];
          if (field.merge == 1) {validCount++}
          else if (sRecordMap[field.name] != tRecordMap[field.name]) {}
          else validCount++;
        }
        if (validCount == register.length) {
          isRecordFound = true;
          for (let rI = 0, rLen = register.length; rI < rLen; rI++) {
            let field = register[rI];
            if (field.merge == 1) {
              tRecordMap[field.name] = sRecordMap[field.name];
            }
          }
          console.log('valid record:', tRecordMap);
        }
      }
      if (!isRecordFound && inTable.mergeNewRecords) {
        console.log('Record Not Found:', sRecordMap);
        let record = {ref:[], values:[], map:sRecordMap};
        this.addNewRecord(record);
      }
    }
    console.log('merge:', this.grid);
  }
  // Remove record from grid.  Then call up the source tree to remove all associated records by setting ref to empty;
  removeRecord(inIndex) {
    let record = this.grid[inIndex];
    if (this.source && record.ref) {
      for (let rI = 0; rI < record.ref.length; rI++) {
        this.source.removeRecord(record.ref[rI]);
      }
    }
    record.ref = [];
  }
  buildGrid(inJSON) {
    let grid = [];
    for (let rI = 0, rLen = inJSON.length; rI < rLen; rI++) {
      let recordMap = inJSON[rI];
      grid.push({ref:[rI], map:recordMap});
    }
    return grid;
  }
  static get definition() {return {name:'Source', type:bc.CLASS, childMap:{
    doMergeTable:{type:bc.SOURCE, mod:bc.ACTION, description:'Merge Source Table into source'},
    doSave:{type:bc.BOOLEAN, mod:bc.ACTION, default:true, description:'Save updates'}
  }}}
}
bc.ControlFactory.newFactory(Source);
class Table extends Source {
  mergeNewRecords = true;
  get visibleRegister() {
    let visibleRegister = [];
    let register = this.register;
    for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
      if (register[fI].visible) visibleRegister.push(register[fI]);
    }
    return visibleRegister;
  }
  static get definition() {return {name:'Table', type:bc.CLASS, childMap:{
    mergeNewRecords:{type:bc.BOOLEAN, mod:bc.FIELD, default:true, description:'If true then merge will add new records if record is not found in source.'},
    debug:{type:bc.BOOLEAN, mod:bc.FIELD, default:false, description:'if true a detailed output of table operation is consoled'},
  }}}
}
bc.ControlFactory.newFactory(Table);
class JSONSource extends Source {
  init(inDesign) {
    if (this._value) {this.grid = this.buildGrid(this._value)}
    else if (this.data) {this.grid = this.buildGrid(this.data)}
  }
  toJSON() {
    let grid = this.grid;
    let json = [];
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {json.push(grid[rI].map)}
    return json;
  }
  buildGrid(inJSON) {
    let grid = [];
    for (let rI = 0, rLen = inJSON.length; rI < rLen; rI++) {
      let recordMap = inJSON[rI];
      grid.push({ref:[rI], map:recordMap});
    }
    return grid;
  }
  injectRecordMap(ref, recordMap) {
    for (let rI = 0, rLen = ref.length; rI < rLen; rI++) {
      let sourceMap = this.grid[ref[rI]].map;
      for (let key in recordMap) {
        sourceMap[key] = recordMap[key];
      }
    }
  }
  toDesignFromDetail(inDesign) {
    return {id:this.id, type:this.type, _value:this.toJSON()};
  }
  static get definition() {return {name:'JSONSource', type:bc.CLASS, childMap:{
    _value:{type:bc.DATA, mod:bc.FIELD}},
    data:{type:bc.DATA, mod:bc.FIELD, description:'JSON array of objects'}}}
}
bc.ControlFactory.newFactory(JSONSource);
class CSVSource extends Source {
  init(inDesign) {
    if (inDesign.url) {
      return new Promise((resolve, reject)=>{
        var xmlRequest = new XMLHttpRequest();
        xmlRequest.open('GET', this.env.buildUrl(this.url));
        xmlRequest.responseType = 'text';
        xmlRequest.onload = ()=>{
          if(xmlRequest.response == '') return;
          this.grid = this.buildGrid(xmlRequest.response);
          resolve();
        }
        xmlRequest.send();
      })
    }
  }
  toJSON() {
    let grid = this.grid;
    let json = [];
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {json.push(grid[rI].map)}
    return json;
  }
  build(contents) {
    let rows = this.parseCsvComplex(contents);
    this.headerStart = 0;
    this.headerCount = 1;
    if (this.gridletFormat) {
      let meta = rows[0][0];
      let parameters = rows[0][0].split('-');
      if (parameters[0] != 'Gridflo') return;
      this.headerStart = 1;
      this.headerCount = Number(parameters[1]);
    }
    let records = [];
    for (let rI = this.headerStart + this.headerCount, rLen = rows.length; rI < rLen; rI++) {
      let values = rows[rI];
      let record = this.buildRecord(rows, values);
      records.push(record);
    }
    return records;
  }
  buildGrid(contents) {
    let rows = this.parseCsvComplex(contents);
    this.headerStart = 0;
    this.headerCount = 1;
    if (this.gridletFormat) {
      let meta = rows[0][0];
      let parameters = rows[0][0].split('-');
      if (parameters[0] != 'Gridflo') return;
      this.headerStart = 1;
      this.headerCount = Number(parameters[1]);
    }
    let grid = [];
    for (let rI = this.headerStart + this.headerCount, rLen = rows.length; rI < rLen; rI++) {
      let values = rows[rI];
      let recordMap = this.buildRecord(rows, values);
      grid.push({ref:[rI], map:recordMap});
    }
    return grid;
  }
  injectRecordMap(ref, recordMap) {
    for (let rI = 0, rLen = ref.length; rI < rLen; rI++) {
      let record = this.grid[ref[rI]];
      for (let key in recordMap) {
        if (record.map[key] != recordMap[key]) {
          record.map[key] = recordMap[key];
        }
      }
    }
  }
  buildRecord(rows, values) {
    let record = {};
    for (let hI = this.headerStart, hLen = this.headerStart + this.headerCount; hI < hLen; hI++) {
      let fields = rows[hI];
      for (let fI = 0, fLen = fields.length; fI < fLen; fI++) {
        let field = fields[fI];
        if (field != '') {
          record[field] = values[fI];
        }
      }
    }
    return record;
  }
  // A complete csv parser.
  parseCsvComplex(ds) {
    let csvArray = new Array();
    let record = new Array();
    let field = "";
    let inQuote = false;
    let useChar = true;
    for (let i = 0; i < ds.length; i++) {
      if (ds[i] == '"') {
        if(inQuote && ds[i+1] == '"') {field += '"'; i++}
        else {inQuote = !inQuote}
      } else {
        if (!inQuote) {
          if (ds[i] == ',') {record.push(field); field = ''}
          else if (ds.charCodeAt(i) == 13) {}
          else if (ds.charCodeAt(i) == 10) {
            record.push(field);
            field = '';
            csvArray.push(record);
            record = new Array();
          } else {field += ds[i]}
        } else {field += ds[i]}
      }
    }
    if (record.length != 0) {
      record.push(field);
      csvArray.push(record);
    }
    return csvArray;
  }
  static get definition() {return {name:'CSVSource', type:bc.CLASS, childMap:{
    gridletFormat:{type:bc.BOOLEAN, mod:bc.FIELD, default:false, description:'Gridlet formated CSV'},
    url:{type:bc.STRING, mod:bc.FIELD, description:'CSV dataset to use'}
  }, description:'CSV Data Source'}}
}
bc.ControlFactory.newFactory(CSVSource);
bc.PrimeDoLoginFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeDoLoginFactory)}
  static get definition() {return {name:'_DoLogin', type:bc.CLASS, childMap:{
    user:{type:bc.STRING, mod:bc.FIELD}, password:{type:bc.STRING, mod:bc.FIELD}, initData:{type:bc.CONTROL, mod:bc.FIELD}, mode:{type:bc.STRING, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeDoLoginFactory());
class Database extends Source {
  status = 'Initialized';
  get doLogin() {return {}}
  async doSendTableAction(inDesign, inDetail) {
    let data = JSON.stringify(inDetail.toJSON());
    await this.server.serverRequest({type:'createMessageRequest', message:{user:this.targetEmail, data:data}});
  }
  async doBuildMessageAction(inDesign, inDetail) {
    console.log('building message action:', inDetail);
    let response = await this.server.serverRequest({type:'messageDataRequest', message:{user:this.userEmail, password:this.password, messageUUID:inDetail}});
    let json = JSON.parse(response.data);
    this.messageDataSource.grid = this.messageDataSource.buildGrid(json);
    console.log('message grid:', this.messageDataSource.grid);
  }
  async doLoginAction(inDesign, inDetail) {
    this.userEmail = inDetail.user;
    this.password = inDetail.password;
    let data = null;
    if (inDetail.initData != null) {
      data = JSON.stringify(inDetail.initData.ref.toJSON());
    }
    let response = await this.server.serverRequest({type:'loginRequest', message:{user:inDetail.user, password:inDetail.password, data:data, mode:inDetail.mode}});
    this.status = response.status;
    if (response.document) this.grid = this.buildGrid(JSON.parse(response.document));
    if (response.messages && this.messageListSource) {
      let messages = response.messages;
      this.messageListSource.grid = this.messageListSource.buildGrid(messages);
      if (messages.length > 0) {
        await this.doBuildMessageAction(null, messages[0].messageUUID);
      }
    }
    // Hack - this needs to move to an Oracle component that queries for a type of data.
    if (response.environments && this.environmentListSource) {
      let environments = response.environments;
      this.environmentListSource.grid = this.environmentListSource.buildGrid(environments);
      console.log('environments:', environments);
    }
    this.token = response.token;
    const sch = this.childMap.statusChangeHandler;
    if (sch) {await sch.doBroadcastAction({'status':this.status}, {}, this) }
  }
  toJSON() {
    let grid = this.grid;
    let json = [];
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {json.push(grid[rI].map)}
    return json;
  }
  buildGrid(inJSON) {
    let grid = [];
    for (let rI = 0, rLen = inJSON.length; rI < rLen; rI++) {
      let recordMap = inJSON[rI];
      grid.push({ref:[rI], map:recordMap});
    }
    return grid;
  }
  async injectRecordMap(ref, recordMap) {
    if (ref.length) {
      for (let rI = 0, rLen = ref.length; rI < rLen; rI++) {
        let sourceMap = this.grid[ref[rI]].map;
        for (let key in recordMap) {
          sourceMap[key] = recordMap[key];
        }
      }
      let data = JSON.stringify(this.toJSON());
      await this.server.serverRequest({type:'loginRequest', message:{user:this.userEmail, password:this.password, data:data, mode:'test'}});
    } else {
      console.log('injectRecordMap - record.ref is empty for:', recordMap);
    }
  }
  async doSaveAction() {
    let data = JSON.stringify(this.toJSON());
    await this.server.serverRequest({type:'loginRequest', message:{user:this.userEmail, password:this.password, data:data, mode:'test'}});
  }
  static get definition() {return {name:'Database', type:bc.CLASS, childMap:{
    messageListSource:{type:bc.SOURCE, mod:bc.FIELD, description:'Message Source'},
    environmentListSource:{type:bc.SOURCE, mod:bc.FIELD, description:'Environment List Source'},
    messageDataSource:{type:bc.SOURCE, mod:bc.FIELD, description:'Message Source'},
    doBuildMessage:{type:bc.STRING, mod:bc.FIELD, description:'Build messageDataSource'},
    targetEmail:{type:bc.STRING, mod:bc.FIELD, description:'target email of message'},
    doSendTable:{type:bc.SOURCE, mod:bc.ACTION, description:'Send a table of data to current recipeant'},
    doLogin:{type:'_DoLogin', mod:bc.ACTION},
    userEmail:{type:bc.STRING, mod:bc.FIELD, default:'userEmail'},
    password:{type:bc.STRING, mod:bc.FIELD},
    token:{type:bc.STRING, mod:bc.FIELD},
    status:{type:bc.STRING, mod:bc.FIELD, default:'Initialized', description:'Initialized,NewUser,PasswordFail,Success'},
    onUpdate:{type:bc.RULES, mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(Database);
class ScriptSource extends Source {
  levelMax = 1;
  toJSON() {
    let grid = this.grid;
    let json = [];
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {json.push(grid[rI].map)}
    return json;
  }
  get grid() {return this.buildGrid()}
  buildGridRecurse(inGrid, inControl, inI, inLevel, inLevelMax) {
    if (inLevel < inLevelMax) {
      inLevel++;
      for (let key in inControl.childMap) {
        let cControl = inControl.childMap[key];
        inGrid.push({ref:[inI++], map:cControl});
        this.buildGridRecurse(inGrid, cControl, inI, inLevel, inLevelMax);
      }
    }
  }
  buildGrid() {
    let control = this.target.ref;
    let grid = [];
    let rI = 0;
    this.buildGridRecurse(grid, control, 0, 0, this.levelMax);
    return grid;
  }
  injectRecordMap(ref, recordMap) {
    console.error('Cant inject just yet');
  }
  static get definition() {return {name:'ScriptSource', type:bc.CLASS, childMap:{levelMax:{type:bc.INTEGER, mod:bc.FIELD, default:1}, target:{type:bc.CONTROL, mod:bc.FIELD}}}}
}
bc.ControlFactory.newFactory(ScriptSource);
class CookieSource extends Source {
  toJSON() {return this.grid[0].map}
  get grid() {return this.buildGrid()}
  buildGrid() {
    let source = document.cookie.split(';');
    let recordMap = {};
    if (source != "") {
      for (let sI = 0, sLen = source.length; sI < sLen; sI++) {
        let keyValue = source[sI].trim().split('=');
        recordMap[keyValue[0]] = keyValue[1];
      }
    }
    return [{ref:[0], map:recordMap}];
  }
  injectRecordMap(ref, recordMap) {
    this.value = [recordMap];
    for (let key in recordMap) {
      let futureDate = new Date();
      futureDate.setUTCFullYear(futureDate.getUTCFullYear()+10);
      document.cookie = key+'='+recordMap[key]+'; expires='+futureDate.toUTCString();
    }
  }
  static get definition() {return {name:'CookieSource', type:bc.CLASS, childMap:{_value:{type:bc.DATA, mod:bc.FIELD}}, description:'Provides an source interface to browser cookies.'}}
}
bc.ControlFactory.newFactory(CookieSource);
class URLSource extends Source {
  toJSON() {return this.grid[0].map}
  get grid() {return this.buildGrid()}
  buildGrid() {
    let entries = new URLSearchParams(window.location.search).entries();
    let recordMap = {};
    for (const entry of entries) {recordMap[entry[0]] = entry[1]}
    return [{ref:[0], map:recordMap}];
  }
  injectRecordMap(ref, recordMap) {}
  static get definition() {return {name:'URLSource', type:bc.CLASS, childMap:{_value:{type:bc.DATA, mod:bc.FIELD}}, description:'Provides an source interface to current URL.'}}
}
bc.ControlFactory.newFactory(URLSource);

class FilteredSource extends Source {
  get grid() {
    let sourceGrid = this.source.ref.grid;
    let filterGrid = this.filter.ref.grid;
    let grid = [];
    for (let sI = 0, sLen = sourceGrid.length; sI < sLen; sI++) {
      let sourceMap = sourceGrid[sI].map;
      for (let fI = 0, fLen = filterGrid.length; fI < fLen; fI++) {
        let filterMap = filterGrid[fI].map;
        let isBad = false;
        for (let key in filterMap) {
          if (filterMap[key] != sourceMap[key]) isBad = true;
        }
        if (!isBad) grid.push(sourceGrid[sI]);
      }
    }
    return grid;
  }
  static get definition() {return {name:'FilteredSource', type:bc.CLASS, childMap:{
    source:{type:bc.CONTROL, mod:bc.FIELD, description:'Source Data'},
    filter:{type:bc.CONTROL, mod:bc.FIELD, description:'Filter Source'},
  }, description:'Filters records based on the filter source.'}}
}
bc.ControlFactory.newFactory(FilteredSource);

// Builds and manages a table of data based on the source.
class BasicTable extends Table {
  recordIndex = -1; sortColumn = 0;
  get current() {return this.record}
  get recordObject() {return this.grid[this.recordIndex].map}
  // Return a field control based on an index
  fieldFromIndex(index) {return this.register[index]}

  init(inDesign) {if (inDesign.isBuilt) {this.doRebuildAction()}}
  buildRecordFromMap(recordFieldMap, map) {
    let record = {ref:[], values:[], map:map};
    let register = this.register;
    for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
      let field = register[fI];
      if (!field.validateFieldValue(record)) return null
    }
    return record;
  }
  // Build a set of potential records from source.  This is an initial pass to
  // that doesn't call the script to set record values.  That is the next filtering step.
  processSourceRecords(grid, sourceGrid) {
    let recordFieldMap = this.record;
    for (let sI = 0, sLen = sourceGrid.length; sI < sLen; sI++) {
      let sourceRecord = sourceGrid[sI];
      if (sourceRecord.ref) {
        let record = this.buildRecordFromMap(recordFieldMap, sourceRecord.map);
        if (record) {
          record.ref = [sI];
          grid.push(record);
        }
      }
    }
    return grid;
  }
  async doHideKnownsAction(inDesign, inDetail) {
    let recordFieldMap = this.record.childMap;
    for (let key in recordFieldMap) {
      let field = recordFieldMap[key];
      field.visible = false;
    }
    await this.doRebuildAction(true, true);
    for (let key in recordFieldMap) {
      let field = recordFieldMap[key];
      if (field.known == '' && !field.isEmpty) field.visible = true;
      else field.visible = false;
    }
  }
  async doBuildFieldsAction(inDesign, inDetail, inHandler) {
    let sGrid = this.source.ref.grid;
    let recordFieldMap = this.record.childMap;
    let order = 0;
    for (let key in recordFieldMap) {
      let field = recordFieldMap[key];
      if (field.order > order) order = field.order;
    }
    let design = {};
    for (let sI = 0, sLen = sGrid.length; sI < sLen; sI++) {
      let sRecordMap = sGrid[sI].map;
      for (let key in sRecordMap) {
        let field = sRecordMap[key];
        if (!recordFieldMap[key] && !design[key]) {
          design[key] = {id:key, type:'StringField', order:++order, default:''};
          let resolvedDesign = await this.resolveDesign(inHandler, inDetail);
          this.factory.modifyDesign(design[key], resolvedDesign);
        }
      }
    }
    await this.executeDesign({record:design});
  }
  // Create a register that is ordered and contains a field object
  buildRegister() {
    let register = [];
    let record = this.record;
    for (let key in record.childMap) {
      let child = record.childMap[key];
      child.addToRegister(register);
    }

    // Find Max Order
    let maxOrder = 0;
    for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
      let field = register[fI];
      if (field.order != null && field.order > maxOrder) maxOrder = field.order;
    }

    // Fill in order for any field that has no order property.
    for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
      let field = register[fI];
      if (field.order == null) field.order = ++maxOrder;
    }

    // Sort fields based on order;
    register.sort((a,b)=>{
      if (b.order == a.order) {return 0}
      else if (b.order <= a.order) {return 1}
      else {return -1}
    })
    return register;
  }

  buildHeaders() {
    let headers = [[{label:this.id, length:0}],[]];
    let register = this.register;
    let spanLength = 0;
    for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
      let field = register[fI];
      spanLength += field.buildHeader(headers[1]);
    }
    headers[0][0].length = spanLength;
    return headers;
  }
  async doQueryAction(inDesign, inDetail, inHandler) {
    const record = this.record;
    for (let key in record.childMap) {
      let child = record.childMap[key];
      if (child) {child.lock = ''}
    }
    await this.factory.executeDesignRecurse(inHandler, this, inDetail, null, null, null);
    await this.doRebuildAction();
  }
  async doRebuildAction() {
    let register = this.register = this.buildRegister();
    let headers = this.headers = this.buildHeaders();
    let sourceGrid = await this.source.ref.getUpdatedGrid();
    let candidates = this.processSourceRecords([], sourceGrid);
    if (this.debug) {
      for (let fI = 0, fLen = register.length; fI < fLen; fI++) {
        let field = register[fI];
      }
    }
    this.grid = [];
    await this.record.processCandidateRecords(this.grid, this.sortColumn, candidates, register);
    // For convenience set the current record after doRebuild.
    if (this.recordIndex == -1 && this.grid.length > 0) {
      this.recordIndex = 0;
      let record = this.grid[this.recordIndex];
      this.record.updateBondWithRecord(record);
    }
    if (this.debug) {
      console.log('table size:', this.grid.length);
    }
  }
  // Reproduce JSON input but with changes made in the grid.
  toJSON() {
    let json = {};
    this.record.ref.toJSON('root', json, this.grid);
    return json.root;
  }
  get recordCount() {
    return this.grid.length;
  }
  doRemoveRecordAction(inDesign, inDetail) {this.removeRecord(this.recordIndex)}
  get hasSelection() {
    return true;
  }
  async doSelectAction(inDesign, inDetail, inHandler) {
    await this.factory.executeDesignRecurse(inHandler, this, inDetail, null, null, null);
    // Find the first record in the grid that matches the locks.
    let grid = this.grid;
    let recordIndex = -1;
    for (let rI = 0, rLen = grid.length; rI < rLen && recordIndex == -1; rI++) {
      let record = grid[rI];
      let found = this.record.updateBondWithRecord(record);
      if (found) {recordIndex = rI}
    }
    this.recordIndex = recordIndex;
  }
  // Deprecated
  doSelectRecordAction(inDesign, inDetail) {
    // Find the first record in the grid that matches the locks.
    let grid = this.grid;
    let recordIndex = -1;
    for (let rI = 0, rLen = grid.length; rI < rLen && recordIndex == -1; rI++) {
      let record = grid[rI];
      let found = this.record.updateBondWithRecord(record);
      if (found) {recordIndex = rI}
    }
    this.recordIndex = recordIndex;
  }
  async doNewRecordAction(inDesign, inDetail) {
    let recordFieldMap = this.record.ref;
    let map = recordFieldMap.toRecordMap();
    let candidates = [this.buildRecordFromMap(recordFieldMap, map)];
    await this.record.processCandidateRecords(this.grid, this.sortColumn, candidates, this.register);
  }
  async addNewRecord(inRecord) {
    let candidates = [inRecord];
    await this.record.processCandidateRecords(this.grid, this.sortColumn, candidates, this.register);
  }
  async doUpdateRecordAction(inDesign, inDetail) {
    if (this.grid.length == 0) {
      let recordFieldMap = this.record.ref;
      let map = recordFieldMap.toRecordMap();
      let candidates = [this.buildRecordFromMap(recordFieldMap, map)];
      await this.record.processCandidateRecords(this.grid, this.sortColumn, candidates, this.register);
    }
    else {
      let record = this.grid[this.recordIndex];
console.log('doUpdateRecordAction - update record:', record, ' bond:', this.record);
      this.record.updateRecordFromBond(record);
    }
  }
  doPushUpRecordAction(inDesign, inDetail) {
    if (this.source) {
      let record = this.grid[this.recordIndex];
      let recordMap = this.record.ref.toRecordMap();
      this.source.ref.injectRecordMap(record.ref, recordMap);
    }
  }
  doClearAction(inDesign, inDetail) {
    for (let rI = 0; rI < this.grid.length; rI++) this.removeRecord(rI);
  }
  doIndexRecordAction(inDesign, inDetail) {
    this.recordIndex = inDetail;
    let record = this.grid[inDetail];
    this.record.updateBondWithRecord(record);
  }
  get doIterateRecords() {return {}}
  async doIterateRecordsAction(inDesign, inDetail) {
    await this.applyRecordRules(this.grid, inDetail);
  }
  async applyRecordRules(inGrid, inRules) {
    for (let rI = 0, rLen = inGrid.length; rI < rLen; rI++) {
      let record = inGrid[rI];
      this.recordIndex = rI;
      this.record.updateBondWithRecord(record);
      await this.executeRules(inRules);
      this.record.updateRecordFromBond(record);
    }
  }
  static get definition() {return {name:'BasicTable', type:bc.CLASS, childMap:{
    source:{type:bc.SOURCE, mod:bc.FIELD, description:'Source from where data is used for the table'},
    grid:{type:bc.DATA, mod:bc.TRAIT, description:'!DEPRECATED'},
    isBuilt:{type:bc.BOOLEAN, mod:bc.FIELD, default:false, description:'If true then BasicTable will be built when created'},
    record:{type:'Record', mod:bc.FIELD, description:'Contains the record structure including field controls, values, locks as children'},
    recordObject:{type:bc.CONTROL, mod:bc.TRAIT, description:'Return the underlying record object for the focused record'},
    recordIndex:{type:bc.INTEGER, mod:bc.FIELD, default:-1, description:'Current Record Index'},
    recordCount:{type:bc.INTEGER, mod:bc.TRAIT, description:'Count of records in table'},
    sortColumn:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Identifies which column to sort'},
    doHideKnowns:{type:bc.TYPE_EMPTY, mod:bc.ACTION, default:true, description:'make known fields not visible'},
    doBuildFields:{type:bc.DATA, mod:bc.ACTION, default:true, description:'Adds fields to records if they are not present'},
    doNewRecord:{type:bc.BOOLEAN, mod:bc.ACTION, description:'Creates a new record based on the values in the record Control.'},
    doUpdateRecord:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Update Record from Definition'},
    doPushUpRecord:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'DEPRECATED _ Update Source with current Record Values'},
    doRebuild:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Rebuild the table from the source'},
    doSelect:{type:bc.RULES, mod:bc.ACTION, description:'Use current locks to select one record'},
    doSelectRecord:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Use current locks to select one record'},
    doRemoveRecord:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Remove the current record pointed to in the record Control.'},
    doIndexRecord:{type:bc.INTEGER, mod:bc.ACTION, description:'Set current record based on an index'},
    doClear:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'DEPRECATED _ Clear records in table'},
    doIterateRecords:{type:bc.RULES, mod:bc.ACTION, description:'Executed for every record in the record Control.'},
    onFormulate:{type:bc.RULES, mod:bc.FIELD, description:'Executed on every candidate record before coalation into the table.'},
    doQuery:{type:bc.RULES, mod:bc.ACTION, description:'Set table query parameters and build table then delete all locks'}
  }, description:'Produces a table based source with records that match specific field names and values'}}
}
bc.ControlFactory.newFactory(BasicTable);
bc.control.RecordIterator = class extends bc.control.Iterator {
  get hasNext() {
    if (this.parent.recordIndex+1 < this.parent.grid.length) return true; return false
  }
  get hasPrevious() {if (this.parent.recordIndex-1 >= 0) return true; return false}
  async doNextAction() {
    if (this.hasNext) {this.parent.recordIndex++}
    else if (this.loop) {this.parent.recordIndex = 0}
    let record = this.parent.grid[this.parent.recordIndex];
    this.parent.record.updateBondWithRecord(record);
    return this.parent.record;
  }
  async doPreviousAction() {
    if (this.hasPrevious) {this.parent.recordIndex--}
    else if (this.loop) {this.parent.recordIndex = this.parent.grid.length-1}
    let record = this.parent.grid[this.parent.recordIndex];
    this.parent.record.updateBondWithRecord(record);
    return this.parent.record;
  }
  doResetAction() {
    this.parent.recordIndex = -1
  }
  get index() {return this.parent.recordIndex}
  set index(inDetail) {this.parent.recordIndex = inDetail}
  get current() {return this.parent.record}
  static get definition() {return {name:'RecordIterator', type:bc.CLASS, childMap:{
    value:{type:'BasicTable', mod:bc.FIELD, description:'The table to iterate'}
  }, description:'Iterator parent records'}}
}
bc.ControlFactory.newFactory(bc.control.RecordIterator);
class MailSource extends Source {
  init(inDesign) {
    this.grid = [];
  }
  async addNewRecord(inRecord) {
    let map = inRecord.map;
    let out = {host:this.host, port:this.port, secure:this.secure, user:this.user, password:this.password, from:map.from, to:map.to, subject:map.subject, text:map.text, body:map.body};
    await this.server.serverRequest({type:'sendMailRequest', message:out});
  }
  static get definition() {return {name:'MailSource', type:bc.CLASS, childMap:{
    host:{type:bc.STRING, mod:bc.FIELD},
    port:{type:bc.INTEGER, mod:bc.FIELD, default:465},
    secure:{type:bc.BOOLEAN, mod:bc.FIELD, default:true},
    user:{type:bc.STRING, mod:bc.FIELD},
    password:{type:bc.STRING, mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(MailSource);
// Used by the TableView for each visible data and header cell in the table.
class ViewCell extends bc.control.Control3D {
  static get definition() {return {name:'ViewCell', type:bc.CLASS, childMap:{
    zone:{type:bc.STRING, mod:bc.FIELD},
    value:{type:bc.STRING, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(ViewCell);
class TableViewCell extends ViewCell {
  get columnHeaders() {
    let pChildMap = this.parent.childMap;
    let columnIndex = this.columnIndex;
    let controls = [];
    for (var key in pChildMap) {
      let child = pChildMap[key];
      if (child.zone == 'header' && child.columnIndex == columnIndex) {controls.push(child)}
    }
    return controls;
  }
  get rowHeaders() {
    let pChildMap = this.parent.childMap;
    let recordIndex = this.recordIndex;
    let controls = [];
    for (var key in pChildMap) {
      let child = pChildMap[key];
      if (child.zone == 'header' && child.recordIndex == recordIndex) {controls.push(child)}
    }
    return controls;
  }
  get columnFields() {
    let pChildMap = this.parent.childMap;
    let columnIndex = this.columnIndex;
    let controls = [];
    for (var key in pChildMap) {
      let child = pChildMap[key];
      if (child.zone == 'field' && child.columnIndex == columnIndex) {controls.push(child)}
    }
    return controls;
  }
  get rowFields() {
    let controls = [];
    if (this.parent) {
      let pChildMap = this.parent.childMap;
      let recordIndex = this.recordIndex;
      for (var key in pChildMap) {
        let child = pChildMap[key];
        if (child.zone == 'field' && child.recordIndex == recordIndex) {controls.push(child)}
      }
    }
    return controls;
  }
  get firstColumnField() {
    let controls = [];
    if (this.parent) {
      let pChildMap = this.parent.childMap;
      let recordIndex = this.recordIndex;
      for (var key in pChildMap) {
        let child = pChildMap[key];
        if (child.zone == 'field' && child.recordIndex == recordIndex && child.columnIndex == 0) {return child}
      }
    }
    console.error('Can not find firstColumnField in ', this.parent);
  }
  get rowHeight() {return this._rowHeight}
  get field() {
    let table = this.parent.table.ref;
    return table.visibleRegister[this.columnIndex];
  }
  get rowValues() {
    let table = this.parent.table.ref;
    let grid = table.grid;
    return grid[this.recordIndex].values;
  }
  get rowIndex() {return this.recordIndex - this.parent.recordOffset}
  // Hack? Syncs up Table Definition.  Is this a good idea?
  doFocusRecordAction() {
    let table = this.parent.table.ref;
    let grid = table.grid;
    table.recordIndex = this.recordIndex;
    let record = grid[table.recordIndex];
    table.record.updateBondWithRecord(record);
  }
  async doUpdateValueAction(inDesign, inDetail) {
    let table = this.parent.table.ref;
    let grid = table.grid;

    // Set table record based on cells recordIndex.
    table.recordIndex = this.recordIndex;
    let record = grid[table.recordIndex];

    table.record.updateBondWithRecord(record);

    // Set field value in the table.
    let field = table.register[this.columnIndex];
    field.value = inDetail;

    // Set the cells value
    this.value = inDetail;

    // Update the record with the recordFieldMap
    table.record.updateRecordFromBond(record);

    let handler = this.parent;
    // Push new value up the source chain.
    await table.doPushUpRecordAction(null, null);
      // Call onUpdate in the TableView for the given cell.
    this.parent._current = this;
    await this.parent.executeRules(this.parent.onUpdate);
  }
  static get definition() {return {name:'TableViewCell', type:bc.CLASS, childMap:{
    doFocusRecord:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Focus Table on Cell Record'},
    doUpdateValue:{type:bc.STRING, mod:bc.ACTION},
    field:{type:'Field', mod:bc.TRAIT, description:'Returns the field for the current Cell'},
    heightMin:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    widthMin:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    recordIndex:{type:bc.INTEGER, mod:bc.FIELD, description:'Return unique record index'},
    rowFields:{type:bc.ARRAY, mod:bc.TRAIT, description:'Current row of fields'},
    rowHeaders:{type:bc.ARRAY, mod:bc.TRAIT, definition:{type:bc.CONTROL}, description:'Current row of headers'},
    rowHeight:{type:bc.FLOAT, mod:bc.TRAIT},
    firstColumnField:{type:bc.CONTROL, mod:bc.TRAIT, description:'Return the first column cell in the current row'},
    columnFields:{type:bc.ARRAY, mod:bc.TRAIT, definition:{type:bc.CONTROL}, description:'Current column of fields'},
    columnHeaders:{type:bc.ARRAY, mod:bc.TRAIT, definition:{type:bc.CONTROL}, description:'Current column of headers'},
    rowValues:{type:bc.DATA, mod:bc.TRAIT},
    rowIndex:{type:bc.INTEGER, mod:bc.TRAIT},
    columnIndex:{type:bc.INTEGER, mod:bc.FIELD, description:'Matches the order number in the table.'},
    value:{type:bc.STRING, mod:bc.FIELD, description:'Text Value of Cell.  This may be different than underlying data'}
  }}}
}
bc.ControlFactory.newFactory(TableViewCell);
bc.PrimeDoFindCellsFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeDoFindCellsFactory)}
  static get definition() {return {name:'_DoFindCells', type:bc.CLASS, childMap:{
    zone:{type:bc.STRING, mod:bc.FIELD}, rowIndex:{type:bc.INTEGER, mod:bc.FIELD}, onFound:{type:bc.RULES, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeDoFindCellsFactory());
class TableView extends bc.control.Control3D {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  columnMin = 1; heightMin = 0; rowMin = 0; rowMax = 100; recordOffset = 0; maxFields = 100; maxHeaders = 100; startHeader = 1; startRow = 0;
  init(inDesign) {
    this.old = {recordOffset:this.recordOffset, rowCount:this.rowCount}
  }
  get eventControls() {
    return this.eventChildren;
  }
  get headerCells() {
    let childMap = this.childMap;
    let controls = [];
    for (var key in childMap) {
      let child = childMap[key];
      if (child instanceof TableViewCell && child.zone == 'header') controls.push(child);
    }
    return controls;
  }
  get fieldCells() {
    let childMap = this.childMap;
    let controls = [];
    for (var key in childMap) {
      let child = childMap[key];
      if (child instanceof TableViewCell && child.zone == 'field') {
        controls.push(child);
      }
    }
    return controls;
  }
  async buildHeaders(table, cellsBuilt) {
    let register = table.visibleRegister;
    let headers = this.headers = [[{label:this.id, length:0}],[]];
    let design = {childMap:{}};
    if (this.startHeader == 0) {
      let key = 'header_0_0';
      design.childMap[key] = {id:key, type:'TableViewCell', zone:'header', recordIndex:0, columnIndex:0, value:key};
    }
    this.columnCount = this.maxFields;
    if (register.length < this.columnCount) this.columnCount = register.length;
    for (let fI = 0; fI < this.columnCount; fI++) {
      let field = register[fI];
      let value = field.id;
      let key = 'header_1_'+fI;
      headers[1].push({label:value, length:1});
      if (!this.childMap[key]) {
        cellsBuilt.push(key);
        design.childMap[key] = {id:key, type:'TableViewCell', zone:'header', recordIndex:1, columnIndex:fI, value:value};
      }
    }
    headers[0][0].length = this.columnCount;
    await this.executeDesign(design);
  }
  async buildGrid(table, cellsBuilt) {
    let grid = table.grid;
    let register = table.visibleRegister;
    let fLen = 0;
    let design = {childMap:{}};
    for (let rI = 0, rLen = this.rowCount; rI < rLen; rI++) {
      for (let fI = 0; fI < this.columnCount; fI++) {
        let gI = rI + this.recordOffset;
        let value = null;
        if (rI < this.recordFillCount) {
          value = register[fI].findValue(grid[gI]);
        } else value = '';
        let key = 'cell_'+gI+'_'+fI;
        if (!this.childMap[key]) {
          cellsBuilt.push(key);
          design.childMap[key] = {id:key, type:'TableViewCell', zone:'field', object:{visible:false}, recordIndex:gI, columnIndex:fI, value:value};
        }
      }
    }
    await this.executeDesign(design);
  }
  measureHeaders(rowStart, rowCount, sizeXs, sizeYs, maxSize) {
    let headers = this.headers;
    for (let rI = rowStart+this.startHeader; rI < rowCount; rI++) {
      let rowSizeY = 0;
      let rowSizeX = 0;
      let fields = headers[rI];
      let fLen = this.maxFields < fields.length ? this.maxFields : fields.length;
      for (let fI = 0; fI < fLen; fI++) {
        let field = fields[fI];
        let control = this.childMap['header_'+rI+'_'+fI].ref;
        let size = control.size;
        rowSizeY = rowSizeY < size.y ? size.y : rowSizeY;
        rowSizeX += size.x;
        maxSize.z = maxSize.z < size.z ? size.z : maxSize.z;
        // Hack - Super hack to make size work.  Whole measurement needs redone.
        if (field.length == 1) sizeXs[fI] = sizeXs[fI] < size.x ? size.x : sizeXs[fI];
      }
      sizeYs[rI] = rowSizeY;
      maxSize.x = maxSize.x < rowSizeX ? rowSizeX : maxSize.x;
      maxSize.y += rowSizeY;
    }
  }
  async adjustHeaders(rowStart, rowCount, sizeXs, sizeYs, maxSize, offsetSize) {
    let headers = this.headers;
    let y = offsetSize.y;
    for (let rI = rowStart+this.startHeader; rI < rowCount; rI++) {
      let x = offsetSize.x;
      let fields = headers[rI];
      let fLen = this.maxFields < fields.length ? this.maxFields : fields.length;
      let cI = 0;
      for (let fI = 0; fI < fLen; fI++) {
        let field = fields[fI];
        let control = this.childMap['header_'+rI+'_'+fI].ref;
        let cEnd = field.length + cI;
        cEnd = cEnd < this.maxFields ? cEnd : this.maxFields;
        let sizeX = 0;
        while (cI < cEnd) {
          sizeX += sizeXs[cI++];
        }
        await control.executeDesign({object:{position:{x:x+sizeX/2, y:y-sizeYs[rI]/2, z:0}}});
        x += sizeXs[fI];
      }
      y -= sizeYs[rI];
    }
  }
  measureGrid(sizeXs, sizeYs, maxSize) {
    for (let rI = 0; rI < this.rowCount; rI++) {
      let rowSizeY = 0;
      let rowSizeX = 0;
      let gI = rI + this.recordOffset;
      for (let fI = 0; fI < this.columnCount; fI++) {
        let control = this.childMap['cell_'+gI+'_'+fI].ref;
        let size = control.size;
        if (size.y < control.heightMin) size.y = control.heightMin;
        rowSizeY = rowSizeY < size.y ? size.y : rowSizeY;
        if (size.x < control.widthMin) size.x = control.widthMin;
        rowSizeX += size.x;
        maxSize.z = maxSize.z < size.z ? size.z : maxSize.z;
        sizeXs[fI] = sizeXs[fI] < size.x ? size.x : sizeXs[fI];
      }
      sizeYs[rI] = rowSizeY;
      maxSize.x = maxSize.x < rowSizeX ? rowSizeX : maxSize.x;
      maxSize.y += rowSizeY;
    }
  }
  async adjustGrid(sizeXs, sizeYs, maxSize, offsetSize) {
    let y = offsetSize.y;
    for (let rI = 0; rI < this.rowCount; rI++) {
      let x = offsetSize.x;
      let gI = rI + this.recordOffset;
      let rowFields = [];
      for (let fI = 0; fI < this.columnCount; fI++) {
        let control = this.childMap['cell_'+gI+'_'+fI].ref;
        rowFields.push(control);
        let width = sizeXs[fI];
        await control.executeDesign({object:{visible:true, position:{x:x+width/2, y:y-sizeYs[rI]/2, z:0}}});
        x += width;
      }
      for (let fI = 0; fI < rowFields.length; fI++) {rowFields[fI]._rowHeight = sizeYs[rI]}
      y -= sizeYs[rI];
    }
  }
  async doAdjustViewAction(inDesign, inDetail) {
    let childMap = this.childMap;
    let table = this.table.ref;
    let sizeXs = this.sizeXs = new Array(this.columnCount);
    for (let cI = 0; cI < this.columnCount; cI++) sizeXs[cI] = 0;
    let headers = this.headers;
    let headerRowCount = headers.length;
    let headerRowStart = headerRowCount - this.maxHeaders;
    if (headerRowStart < 0) headerRowStart = 0;
    let headerSizeYs = new Array(headerRowCount);
    let maxSize = {x:0, y:0, z:0};
    this.measureHeaders(headerRowStart, headerRowCount, sizeXs, headerSizeYs, maxSize);
    let headerSizeY = maxSize.y;
    let gridSizeYs = this.sizeYs = new Array(this.rowCount);
    this.measureGrid(sizeXs, gridSizeYs, maxSize);
    let offsetSize = {x:-maxSize.x/2, y:maxSize.y/2, z:0};
    await this.adjustHeaders(headerRowStart, headerRowCount, sizeXs, headerSizeYs, maxSize, offsetSize);
    offsetSize.y -= headerSizeY; // Put Grid under Headers
    await this.adjustGrid(sizeXs, gridSizeYs, maxSize, offsetSize);
    let rowCount = 5;
    let rows = [];
    for (let rI = 0, rLen = this.rowCount; rI < rLen; rI++) {
      rows.push(this.childMap['cell_'+Number(rI+this.recordOffset)+'_0']);
    }
    this.rows = rows;
  }
  // Only remove cells that have moved out of view.
  async doUnbuildPartialView(inDesign, inDetail) {
    let offsetDiff = this.recordOffset - this.old.recordOffset;
    let countDiff = this.recordCount - this.old.recordCount;
    let rowStart = 0;
    let rowEnd = 0;
    if (offsetDiff > 0) {
      rowStart = 0;
      rowEnd = offsetDiff;
    } else {
      rowStart = this.rowCount + offsetDiff;
      rowEnd = this.rowCount;
    }
    if (rowStart < 0) rowStart = 0;
    if (rowEnd > this.rowCount) rowEnd = this.rowCount;
    for (let rI = rowStart; rI < rowEnd; rI++) {
      let gI = rI + this.old.recordOffset;
      for (let fI = 0; fI < this.columnCount; fI++) {
        let key = 'cell_'+gI+'_'+fI;
        this.removeChild(this.childMap[key]);
      }
    }
  }
  async doUpdateViewAction(inDesign, inDetail) {
    let childMap = this.childMap;
    if (!childMap) this.childMap = {};
    let table = this.table.ref;
    await this.doUnbuildPartialView(null, null);
    this.isBuilt = true;
    let grid = table.grid;
    if (grid.length <= inDetail.recordOffset) this.recordOffset = 0; // Make sure offset is less than record data length.
    this.recordFillCount = (grid.length - this.recordOffset) > this.rowMax ? this.rowMax : grid.length - this.recordOffset;
    this.recordEmptyCount = this.rowMin > this.recordFillCount ? this.rowMin - this.recordFillCount : 0;
    this.rowCount = this.recordFillCount + this.recordEmptyCount;
    let cellsBuilt = [];
    await this.buildHeaders(table, cellsBuilt);
    await this.buildGrid(table, cellsBuilt);
    let cells = [];
    for (let cI = 0, cLen = cellsBuilt.length; cI < cLen; cI++) cells.push(this.childMap[cellsBuilt[cI]]);
    await this.iterateControlsWithRules(cells, this.onBuild);
    await this.iterateControlsWithRules(cells, this.onUpdate);
    await this.doAdjustViewAction(null, null);
    this.old = {recordOffset:this.recordOffset, rowCount:this.rowCount}
  }
  get doFindCells() {return {}}
  doFindCellsAction(inDesign, inDetail, inHandler) {
    let childMap = this.childMap;
    let controls = [];
    for (var key in childMap) {
      let child = childMap[key];
      if ((inDetail.zone == null || inDetail.zone == child.zone) &&
          (inDetail.rowIndex == null || inDetail.rowIndex == child.rowIndex)) controls.push(child);
    }
    return inHandler.iterateControlsWithRules(controls, inDetail.onFound);
  }
  get recordCount() {
    return this.table.ref.grid.length;
  }
  // Remove all display cells.
  doUnbuildViewAction(inDesign, inDetail) {
    this.isBuilt = false;
    if (this.childMap) {
      let childMap = this.childMap;
      for (let key in childMap)
      {if (childMap[key] instanceof ViewCell) {this.removeChild(childMap[key])}}
    }
  }
  async doBuildViewAction(inDesign, inDetail) {
    let childMap = this.childMap;
    if (!childMap) this.childMap = {};
    let table = this.table.ref;
    await this.doUnbuildViewAction(null, null);
    this.isBuilt = true;
    let grid = await table.getUpdatedGrid();
    this.old = {recordOffset:0, recordCount:this.recordCount};  // Reset old values since we deleted all Cells.
    if (this.recordCount <= inDetail.recordOffset) this.recordOffset = 0; // Make sure offset is less than record data length.
    this.recordFillCount = (grid.length - this.recordOffset) > this.rowMax ? this.rowMax : grid.length - this.recordOffset;
    this.recordEmptyCount = this.rowMin > this.recordFillCount ? this.rowMin - this.recordFillCount : 0;
    this.rowCount = this.recordFillCount + this.recordEmptyCount;
    let cellsBuilt = [];
    await this.buildHeaders(table, cellsBuilt);
    await this.buildGrid(table, cellsBuilt);
    let cells = [];
    for (let cI = 0, cLen = cellsBuilt.length; cI < cLen; cI++) cells.push(this.childMap[cellsBuilt[cI]]);
    await this.iterateControlsWithRules(cells, this.onBuild);
    await this.iterateControlsWithRules(cells, this.onUpdate);
    await this.doAdjustViewAction(null, null);
  }
  static get definition() {return {name:'TableView', type:bc.CLASS, childMap:{
    columnMin:{type:bc.INTEGER, mod:bc.FIELD, default:1},
    columnCount:{type:bc.INTEGER, mod:bc.FIELD, default:0},
    current:{type:'TableViewCell', mod:bc.TRAIT, description:'Current TableViewCell'},
    doAdjustView:{type:bc.TYPE_EMPTY, mod:bc.ACTION, default:true, description:'Readjust View with any changed properties'},
    doBuildView:{type:bc.TYPE_EMPTY, mod:bc.ACTION, default:true, description:'Build all cells in view'},
    doFindCells:{type:'_DoFindCells', mod:bc.ACTION},
//    doUnbuildPartialView:{type:bc.BOOLEAN, mod:bc.ACTION, default:true, description:'Remove unneeded cells after scroll'},
    doUnbuildView:{type:bc.TYPE_EMPTY, mod:bc.ACTION, default:true, description:'Remove all view cells'},
    doUpdateView:{type:bc.TYPE_EMPTY, mod:bc.ACTION, default:true, description:'Update view to reflect new scroll position'},
    heightMin:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    rows:{type:bc.MAP, mod:bc.TRAIT, definition:{type:bc.CONTROL}},
    rowCount:{type:bc.INTEGER, mod:bc.FIELD},
    rowMin:{type:bc.INTEGER, mod:bc.FIELD, default:0},
    rowNow:{type:bc.INTEGER, mod:bc.FIELD},
    rowMax:{type:bc.INTEGER, mod:bc.FIELD, default:100},
    recordFillCount:{type:bc.INTEGER, mod:bc.FIELD, description:'Number of non empty records showing'},
    recordEmptyCount:{type:bc.INTEGER, mod:bc.FIELD, description:'Number of empty records showing'},
    recordCount:{type:bc.INTEGER, mod:bc.TRAIT},
    recordOffset:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Index of first record visible'},
    onBuild:{type:bc.RULES, mod:bc.FIELD},
    onUpdate:{type:bc.RULES, mod:bc.FIELD},
    eventControls:{type:bc.DATA, mod:bc.TRAIT},
    fieldCells:{type:bc.ARRAY, mod:bc.TRAIT, definition:{type:bc.CONTROL}},
    headerCells:{type:bc.ARRAY, mod:bc.TRAIT, definition:{type:bc.CONTROL}},
    isBuilt:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    maxFields:{type:bc.INTEGER, mod:bc.FIELD, default:100},
    maxHeaders:{type:bc.INTEGER, mod:bc.FIELD, default:100},
    table:{type:'Table', mod:bc.FIELD},
    startHeader:{type:bc.INTEGER, mod:bc.FIELD, default:1},
    startRow:{type:bc.INTEGER, mod:bc.FIELD, default:0},
  }}}
}
bc.ControlFactory.newFactory(TableView);
class Fire extends bc.control.Control3D {
  time = .0005; fireSize = .5; particles = 500;
  init(inDesign) {
    this.material = new THREE.RawShaderMaterial({
      uniforms: {time:{value: 0.0}, fireSize:{value:this.fireSize}, yMax:{value: 0.3 + Math.PI * this.fireSize}},
      vertexShader: Fire.vertexShader,
      fragmentShader: Fire.fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
    });
    if (this.fireMesh) this.object3D.remove(this.fireMesh);
    this.material.uniforms.fireSize.value = this.fireSize;
    let geometry = this.createSparks(this.particles);
    this.fireMesh = new THREE.Mesh(geometry, this.material);
    this.object3D.add(this.fireMesh);
    this.doPlayPromise();
  }
  async doPlayPromise() {
    let process = this.processor.newProcess({name:'Fire'});
    let now = Date.now();
    let startTime = now;
    do {
      this.material.uniforms.time.value = (now - startTime) * this.time;
      now = await process.tickWait();
    } while (now > 0);
    this.processor.removeProcess(process);
  }
  createSparks(count) {
    let positions = [];
    let directions = [];
    let offsets = [];
    let verticesCount = count * 3;

    for (let i = 0; i < count; i += 1) {
      let direction = [Math.random() - 0.5,(Math.random() + 0.3),Math.random() - 0.5];
      let offset = Math.random() * Math.PI;
      let xFactor = 1;
      let zFactor = 1;

      for (let j = 0; j < 3; j += 1) {
        let x = Math.random() - 0.5;
        let y = Math.random() - 0.2;
        let z = Math.random() - 0.5;

        positions.push(x, y, z);
        directions.push(...direction);
        offsets.push(offset);
      }
    }
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('direction', new THREE.Float32BufferAttribute(directions, 3));
    geometry.setAttribute('offset', new THREE.Float32BufferAttribute(offsets, 1));

    return geometry;
  }
  remove() {
    this.object3D.remove(this.fireMesh);
    this.fireMesh = null;
    super.remove();
  }
  static get vertexShader() {return `
    precision highp float;
    #define PI 3.1415926535897932384626433832795
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform float time;
    uniform float fireSize;

    attribute vec3 position;
    attribute vec3 direction;
    attribute float offset;
    varying vec3 vUv;
    void main() {
        float sawTime = mod(time * offset, PI);
        float sineTime = (sawTime * abs(sin(time * offset)));
        vec3 timeVec = vec3(sineTime, sawTime, sineTime);
        vUv = ((normalize(position) * 0.2) + (timeVec * direction)) * fireSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( vUv, 1.0 );
    }
  `}
  static get fragmentShader() {return `
    precision highp float;
    uniform float time;
    uniform float yMax;
    varying vec3 vUv;
    float random(vec2 ab) {
        float f = (cos(dot(ab ,vec2(21.9898,78.233))) * 43758.5453);
        return fract(f);
    }
    void main() {
        float alpha = (yMax - vUv.y) * 0.8;
        float red = 1.0;
        float green = 0.3 + (0.7 * mix(((yMax - vUv.y) * 0.5) + 0.5, 0.5 - abs(max(vUv.x, vUv.y)), 0.5));
        float blueMin = abs(max(max(vUv.x, vUv.z), (vUv.y / yMax)));
        float blue = (1.0 / (blueMin + 0.5)) - 1.0;
        gl_FragColor = vec4(red, green, blue, alpha);
    }
  `}
  static get definition() {return {name:'Fire', type:bc.CLASS, childMap:{
     time:{type:bc.FLOAT, mod:bc.FIELD, default:.0005, description:'Time division that changes fire speed'},
	   fireSize:{type:bc.FLOAT, mod:bc.FIELD, default:.5, description:'Size of fire'},
	   particles:{type:bc.INTEGER, mod:bc.FIELD, default:500, description:'Number of particles in the fire'},
  }}}
}
bc.ControlFactory.newFactory(Fire);
export {TableView}
