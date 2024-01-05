import * as THREE from 'three';
import {OBJLoader} from '/js/node/node_modules/three/examples/jsm/loaders/OBJLoader.js';
import {MTLLoader} from '/js/node/node_modules/three/examples/jsm/loaders/MTLLoader.js';
import {KTXLoader} from '/js/node/node_modules/three/examples/jsm/loaders/KTXLoader.js';
import {FBXLoader} from '/js/node/node_modules/three/examples/jsm/loaders/FBXLoader.js';
import {ColladaLoader} from '/js/node/node_modules/three/examples/jsm/loaders/ColladaLoader.js';
import {GLTFLoader} from '/js/node/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {HDRCubeTextureLoader} from '/js/node/node_modules/three/examples/jsm/loaders/HDRCubeTextureLoader.js';
import {RGBELoader} from '/js/node/node_modules/three/examples/jsm/loaders/RGBELoader.js';
import {BasisTextureLoader} from '/js/node/node_modules/three/examples/jsm/loaders/BasisTextureLoader.js';
import {SimplifyModifier} from '/js/node/node_modules/three/examples/jsm/modifiers/SimplifyModifier.js';
import {PMREMGenerator} from '/js/node/node_modules/three/src/extras/PMREMGenerator.js';

console.log("threejs version: " + THREE.REVISION);

var arToolkitContext = null;
var arToolkitSource = null;
var bc = {
  control : {},
  factories : {},
  FULL_DESIGN : 1, // Returns design with transient elements
  PART_DESIGN : 2, // Returns design without transient elements like user parts and locks.
  CONTINUE : 1, // Used by timeListener to tell listener to continue time event.
  FINISH : 0, // Used by timeListener to tell listener to finish up time event.
  STRING : 'STRING',
  INTEGER : 'INTEGER',
  CONTROL : 'Control',
  CLASS : 'CLASS',
  FLOAT : 'FLOAT',
  DATA : 'DATA',
  TYPE_EMPTY : 'DATA',  // Right now same as data to denote no parameters in an Action.
  OBJECT : 'OBJECT',
  MAP : 'MAP',
  TRAIT : 'TRAIT',
  ARRAY : 'ARRAY',
  BOOLEAN : 'BOOLEAN',
  ACTION : 'ACTION',
  RULES : 'RULES',
  FIELD : 'FIELD',
  GEOMETRY : 'Geometry',
  MATERIAL : 'Material',
  SOURCE : 'Source',
  TEXTURE : 'Texture',
  TABLE : 'Table',
  VECTOR : '_Vector',
  INTERSECT_EVENT : 'intersectEvent',
  ENVIRONMENT_COMPLETE_EVENT : 'environmentCompleteEvent',
  ADD_CONTROLLER_EVENT : 'addControllerEvent',
  ADD_USER_EVENT : 'addUserEvent',
  KEYBOARD_EVENT : 'keyboardEvent',
  CONTROLLER_EVENT : 'controllerEvent'
}
var debugDelay = 60000;
var debugMode = false;
var debugCount = 0;
var multiUser = true;

// Base class for all factories
bc.Factory = class {}
bc.ControlFactory = class extends bc.Factory {
  constructor(inClass) {
    super();
    let currentClass = this.instanceClass = inClass;
    // Build a definition based on the prototype hierarchy
    let definition = currentClass.definition;
    if (!definition) console.error('No definition for:', inClass);
    if (definition.type != bc.CLASS) console.error('CLASS ', inClass, ' not properly defined ', definition);
    this.parentClass = Object.getPrototypeOf(currentClass);
    while (currentClass.definition) {
      let protoDefinition = currentClass.definition;
      for (let key in protoDefinition.childMap) {
        let cDef = definition.childMap[key];
        if (!cDef) {
          cDef = definition.childMap[key] = protoDefinition.childMap[key]
        }
        if (cDef.type == bc.OBJECT) {
          console.error('Legacy type:bc.OBJECT - key:', key, ' def:', definition, ' cDef:', cDef);
        }
      }
      currentClass = Object.getPrototypeOf(currentClass);
    }
    this.fullDefinition = definition;
  }
  get name() {return this.fullDefinition.name}
  setField(inInstance, inKey, inDetail) {
    let def = this.fullDefinition;
    let cDef = def.childMap[inKey];
    // If a property definition is found then set the property value.
    if (cDef) {
      let mod = cDef.mod;
      if (mod == bc.FIELD) {inInstance[inKey] = inDetail}
      else {console.error('In ', inInstance, ' Can not set ', inKey, ' of type:', cDef.type, ' mod:', mod); debugger}
    }
    // If a child is found at the key and it has a value property then set the value property of the child instead.
    else if (inInstance instanceof bc.control.Control) {
      let child = inInstance.childMap[inKey];
      if (child && child.factory.fullDefinition.childMap.value) {inInstance.childMap[inKey].value = inDetail}
      else if (inDetail instanceof bc.control.Control) {inInstance.childMap[inKey] = inDetail}
      else {console.error('Can not create ', inKey, ' in ', inInstance.localId)}
    }
  }
  getField(inInstance, inKey) {
    let out = null;
    let def = this.fullDefinition;
    let cDef = null;

    if (inKey == 'childMap') {return [inInstance.factory, inInstance, bc.TRAIT]}  // Legacy
    cDef = def.childMap[inKey];
    // If a property is found in the definition then set the property.  If the value is a control then return the child.factory as type.
    if (cDef) {
      let child = inInstance[inKey];
      if (child != null && child instanceof bc.control.Control) return [child.factory, child, cDef.mod];
      else return [bc.ControlFactory.factoryOf(cDef.type), child, cDef.mod]
    }
    // Otherwise check for children controls.
    else if (inInstance instanceof bc.control.Control) {
      let childMap = inInstance.childMap;
      let child = childMap[inKey];
      if (child) {return [child.factory, child, bc.FIELD]}
      else {return [bc.ControlFactory.factoryOf(bc.CONTROL), null, bc.FIELD]}
    }
    console.error('can not find ', inKey, ' in instance:', inInstance);
    debugger;
    return [null, null, null];
  }
  // Load a model design from url
  loadModel(inModel) {
    return new Promise((resolve, reject)=>{
      let xmlRequest = new XMLHttpRequest();
      xmlRequest.open('GET', '/'+inModel);
      xmlRequest.responseType = 'text';
      xmlRequest.onload = ()=>{
        if(xmlRequest.response == '') {reject({error:'Bad Response', response:xmlRequest.response})}
        let design = bc.world.toDesignFromString(xmlRequest.response);
        resolve(design);
      }
      xmlRequest.send();
    })
  }
  // This magical piece of code returns a serialized JSON structure with only the differences between a model and the current object state.
  // If the object property values equal the defalut value then those values are left out of the serialization.
  buildPointerString(inInstance, inReference) {
    // Make sure the reference is pointing to something and that something isn't deleted.
    let current = inReference;
    let refPath = [];
    while (current != null) {refPath.push(current); current = current.parent}
    refPath.reverse();
    current = inInstance;
    let ptrPath = [];
    while (current != null) {ptrPath.push(current); current = current.parent}
    ptrPath.reverse();
    let pI = 0;
    while (pI < refPath.length && pI < ptrPath.length && refPath[pI] === ptrPath[pI]) pI++;
    let path = [];
    --pI;
//      if (--pI) {
      while (pI >= 0) {
        let ptr = refPath[pI];
        if (
            ptr instanceof bc.control.Concept ||
            ptr instanceof bc.control.Area ||
            ptr instanceof bc.control.Environment ||
            ptr instanceof bc.control.World) break;
        pI--;
      }
      let ptr = refPath[pI];
      if (ptr instanceof bc.control.Concept) {path.push('concept')}
      else if (ptr instanceof bc.control.Area) {path.push('area')}
      else if (ptr instanceof bc.control.Environment) {path.push('env')}
      else if (ptr instanceof bc.control.World) {path.push('world')}
      else {console.error('this:', this,' No Head Node index:', pI, ' ptr:', ptrPath, ' ref:', refPath); debugger}
      pI++;
//      }
    for (;pI < refPath.length; pI++) path.push(refPath[pI].id);
    let outDesign = [path.join('.')];
    return outDesign;
  }

  // Deep copy a json structure.
  copyDesign(design) {return JSON.parse(JSON.stringify(design))}

  // Modify the currentDesign with the modDesign.
  modifyDesign(currentDesign, modDesign){
    if (modDesign) {
      let fullDefinition = this.fullDefinition;
      for (let key in modDesign) {
        let modValue = modDesign[key];
        if (modValue != null) {
          let childDef = fullDefinition.childMap[key];
          let currentValue = currentDesign[key];
          let factory = bc.ControlFactory.factoryOf('Control');
          if (childDef != null) {
            factory = bc.ControlFactory.factoryOf(childDef.type);
          }
          else if (typeof currentValue == 'object') {
            if (currentValue.type) {
              factory = bc.ControlFactory.factoryOf(currentValue.type);
            }
          }
          let cDef = factory.fullDefinition;
          // If a formula is found in the modification overwrite the property with the mod value.
          if (Array.isArray(modValue)) {
            if (cDef.childMap.value) {currentDesign[key].value = modValue}
            else currentDesign[key] = modValue;
          }
          else if ((typeof modValue == 'object')) {
            if (modValue.type && modValue.type == 'Remove') delete currentDesign[key];
            else {
              if (currentDesign[key] == null) {
                if (Array.isArray(modValue)) currentDesign[key] = [];
                else currentDesign[key] = {};
              }
              factory.modifyDesign(currentDesign[key], modValue);
            }
          } else {
            if (cDef.childMap.value) {currentDesign[key].value = modValue}
            else currentDesign[key] = modValue;
          }
        }
      }
    }
  }

  toDesignFromDetailRecurse(inInstance, inMode, inDesign) {
    let design = {};
    let keyCount = 0;
    let def = this.fullDefinition;
    let defMap = def.childMap;
    // if its a Control then traverse the children.
    if (inInstance.childMap) {
      let cMap = inInstance.childMap;
      for (let key in cMap) {
        if (!cMap[key]) console.error('toDesign failed at key:', key, ' inInstance:', inInstance, ' child:', cMap[key]);
        else if (cMap[key].parent !== inInstance) {
          // If the child is not from the current control then build a pointer to it.
          let pointerString = this.buildPointerString(inInstance, cMap[key]);
          design[key] = pointerString;
        }
        else {
          let diffDesign = null;
          if (inDesign) diffDesign = inDesign[key];
          const cDesign = cMap[key].factory.toDesignFromDetail(cMap[key], inMode, diffDesign);
          if (cDesign != null) {design[key] = cDesign; keyCount++}
        }
      }
    }
    for (let key in defMap) {
      let cDef = defMap[key];
      let cMod = cDef.mod;
      let cType = cDef.type;
      let diffDesign = null;
      if (inDesign) diffDesign = inDesign[key];
      if (cMod == bc.ACTION || cMod == bc.TRAIT || (cDef.volatile && inMode == bc.PART_DESIGN)) {}
      else if (cType == bc.RULES || cType == bc.DATA) {
        let cInstance = inInstance[key];
        if (cInstance != null && !diffDesign) {design[key] = cInstance; keyCount++}
      }
      else {
        let cInstance = inInstance[key];
        if (cInstance == null) {}
        else {
          let cFactory = bc.ControlFactory.factoryOf(cType);
          if (typeof cInstance === 'object') {
            if (cInstance instanceof bc.control.Control) {
              // If the child is not from the current control then build a pointer to it.
              if (cInstance.parent != inInstance) {
                const cDesign = this.buildPointerString(inInstance, cInstance);
                design[key] = cDesign;
                keyCount++;
              }
              else {
                const cDesign = cFactory.toDesignFromDetail(cInstance, inMode, diffDesign);
                if (cDesign != null) {design[key] = cDesign; keyCount++}
              }
            } else {
              const cDesign = cFactory.toDesignFromDetail(cInstance, inMode, diffDesign);
              if (cDesign != null) {design[key] = cDesign; keyCount++}
            }
          }
          else {
            if (diffDesign != null) {
              if (cInstance !== diffDesign) {design[key] = cInstance; keyCount++}
            }
            else if (cDef.default !== cInstance) {design[key] = cInstance; keyCount++}
          }
        }
      }
    }
    if (keyCount) {design.type = def.name} else {design = null}
    return design;
  }
  toDesignFromDetail(inInstance, inMode, inDesign) {return inInstance.toDesignFromDetail(inMode, inDesign)}
  // This is for factories that handle their own build process.
  build(inDesign) {console.error('build can not be called on a high level component')}
  buildInstance (inParent, inDesign) {
    let instance = new this.instanceClass(inParent, inDesign);
    instance.factory = this;
    // Connect parent and child THREEJS components.
    if (!(inParent instanceof bc.control.World) && instance instanceof bc.control.Control3D) {
      let parent = inParent;
      while (parent != null && !(parent instanceof bc.control.Control3D)) {parent = parent.parent}
      if (parent == null) console.error('No Parent Found to attach object3D ', instance);
      else {
        instance.object3D.name = inDesign.id;
        parent.object3D.add(instance.object3D)
      }
    }
    return instance;
  }
  static newInstance(inType, inParent, inDetail) {
    let factory = bc.ControlFactory.factoryOf(inType);
    return factory.buildInstance(inParent, inDetail);
  }
  static definitionOf(inName) {return bc.ControlFactory.factoryOf(inName).fullDefinition}
  static factoryOf(inName) {return bc.factories[inName]}
  static addFactory(inFactory) {
    let name = inFactory.name;
    if (bc.ControlFactory.factoryOf(name)) console.error ('Factory already exists - ', name);
    let factory = bc.factories[name] = inFactory;
  }
  static newFactory(inClass) {
    let name = inClass.definition.name;
    if (bc.ControlFactory.factoryOf(name)) console.error ('Factory already exists - ', name);
    let factory = bc.factories[name] = new bc.ControlFactory(inClass);
  }
  handlePromise(inPromise) {
    if (inPromise instanceof Promise) {
//console.log('handlePromise - Promise!!!', inRequest);
      return inPromise; }
    else if (inPromise == null) {
      return new Promise((resolve, reject)=>{resolve()}); }
    else {
      console.error('Not Promise Found ', inPromise);
      console.trace();
      debugger;
    }
  }
  handleAction(inInstance, inKey, cDesign, cInstance, inHandler) {
    let result = inInstance[inKey+'Action'](cDesign, cInstance, inHandler);

    if (result instanceof Promise) {return result}
    else if (result == null) {return new Promise((resolve, reject)=>{resolve()})}
    else {
      console.error('Not Promise Found ', inPromise);
      console.trace();
      debugger;
    }
  }

  // Hack - This needs to eventually follow the path of the handler to make sure the design is accurate.
  // in other words it needs to syntax check against the target.
  async resolveDesignRecurse(inHandler, inFactory, inDesign) {
    if (Array.isArray(inDesign)) {
      const design = [];
      for (let dI = 0, dLen = inDesign.length; dI < dLen; dI++) {
        const cDesign = inDesign[dI];
        design[dI] = await this.resolveDesignRecurse(inHandler, inFactory, cDesign);
      }
      return design
    }
    else {
      const design = {};
      for (let key in inDesign) {
        const cDesign = inDesign[key];
        if (Array.isArray(cDesign)) {
          let detail = await inHandler.factory.evaluate(inHandler, cDesign);
          if (detail instanceof bc.control.Control) {design[key] = [detail.localId]}
          else if (detail instanceof THREE.Vector3 || detail instanceof THREE.Euler) {
            // Hack - super hack.  Need to fix resolve to travel the handler object tree to determine types.
            design[key] = {x:detail.x, y:detail.y, z:detail.z};
          }
          else if (detail != null) {design[key] = detail}
          else {design[key] = ''}
        }
        else if (typeof cDesign == 'object') {
          design[key] = await this.resolveDesignRecurse(inHandler, inFactory, cDesign)}
        else design[key] = inDesign[key];
      }
      return design;
    }
  }
  async toValueFromPath(inInstance, inPath, inThisFactory, inThisInstance) {
    let factory = this;
    let instance = inInstance;
    let result = new Array(5);
    // If a dot is in front then start at current or this.
    let pI = 0;
    if (inPath[0] == '') {
      factory = inThisFactory;
      instance = inThisInstance;
      pI = 1;
    }
    for (let pLen = inPath.length; pI < pLen; pI++) {
      let key = inPath[pI];
      let cFactory;
      let cInstance;
      // Hack - This is a way for a script writer to get the current object for example a Pointer instead of the Pointer reference.
      if (key == 'me') {console.error('ME is used inInstance:', inInstance, ' inPath:', inPath); result[2] = key; result[3] = factory; result[4] = instance};
      if (instance instanceof bc.control.Control) {
        // Look for the property up the parent ancestor tree.
        while (instance) {
          let anchor = instance.childMap[key];
          if (anchor instanceof bc.control.Anchor) {await anchor.waitForFinish()};
          let child = factory.getField(instance, key);
          cFactory = child[0];
          cInstance = child[1];

          if (cInstance != undefined) {break}
          else {instance = instance.parent}
        }
      } else {
        let child = factory.getField(instance, key);
        cFactory = child[0];
        cInstance = child[1];
      }
      while (pI < pLen-1 && cInstance instanceof bc.control.Pointer) {
        cInstance = cInstance.ref;
        if (cInstance !== '') {
          try {
          let anchor = cInstance.childMap[key];
          if (anchor instanceof bc.control.Anchor) {console.warn('Waiting for Anchor???'); await anchor.waitForFinish()};
          cFactory = cInstance.factory
          } catch(e) {console.error('key:', key, ' cInstance:', cInstance, ' e:', e)}
        }
      }
      if (cInstance == null || cInstance == undefined) {
        console.log('toValueFromPath - null key:', key, ' inPath:', inPath, ' inInstance:', inInstance, ' instance:', instance, ' factory:', factory);
        console.trace();
        debugger;
      }
      result[0] = factory;
      result[1] = instance;
      result[2] = key;
      result[3] = cFactory;
      result[4] = cInstance;
      factory = cFactory;
      instance = cInstance;
    }
    return result;
  }
  // Check to see if the object has a value property and use it instead.
  valueCheck(inRef) {
    let def = inRef[3].fullDefinition.childMap;
    if (def.value) {inRef[3] = def.value.type; inRef[4] = inRef[4].value}
    return inRef;
  }
  // Evaluate an expression.
  async evaluate(inInstance, inExpression, inThisFactory, inThisInstance, inType) {
    console.assert(Array.isArray(inExpression), 'Expression is not a Formula:',inExpression);
    let opCheck = bc.world.ops;
    let opMap = bc.world.opMap;
    let inValues = [];
    let inOps = [];
    for (let pI = 0, pLen = inExpression.length; pI < pLen; pI++) {
      let part = inExpression[pI];
      if (Array.isArray(part)) {
        part = await this.evaluate(inInstance, part, inThisFactory, inThisInstance, inType);
        if (!isNaN(part)) part = Number(part)}
      if (typeof part == 'string') {
        if (part.length == 0) {inValues.push([null, null, null, bc.ControlFactory.factoryOf(bc.STRING), part])} // If empty then push ''.
        else if (part[0] == '#') inValues.push([null, null, null, bc.ControlFactory.factoryOf(bc.STRING), part.substr(1)]); // If # then add static string
        else if (opCheck[part.charCodeAt(0)]) {
          while (inOps.length && opMap[inOps[inOps.length-1]].o >= opMap[part].o) {
            let v2 = this.valueCheck(inValues.pop())[4]; v2 = isNaN(v2) ? v2 : Number(v2);
            if (v2 instanceof bc.control.Control) v2 = v2.ref;
            let v1 = this.valueCheck(inValues.pop())[4]; v1 = isNaN(v1) ? v1 : Number(v1);
            if (v1 instanceof bc.control.Control) v1 = v1.ref;
            let op = inOps.pop();
            let result = opMap[op].f(v1, v2);
            inValues.push([null, null, null, bc.ControlFactory.factoryOf(bc.STRING), result]) }
          inOps.push(part)
        }
        else {  // Process path pointer
          let path = part.split('.');
          let result = await this.toValueFromPath(inInstance, path, inThisFactory, inThisInstance);
//          if (result[4] instanceof bc.control.Control) {result[4] = result[4].ref}
          inValues.push(result);
        }
      }
      else if (typeof part == 'object') {
        if (part.string) {inValues.push([null, null, null, bc.ControlFactory.factoryOf(bc.STRING), part.string])}
        else {inValues.push([null, null, null, bc.ControlFactory.factoryOf(bc.STRING), part])} }
      else {inValues.push([null, null, null, bc.ControlFactory.factoryOf(bc.STRING), part])}
    }
    while (inOps.length) {
      let v2 = this.valueCheck(inValues.pop())[4];
      if (v2 instanceof bc.control.Control) v2 = v2.ref;
//        v2 = isNaN(v2) ? v2 : Number(v2);
      let v1 = this.valueCheck(inValues.pop())[4];
      if (v1 instanceof bc.control.Control) v1 = v1.ref;
//        v1 = isNaN(v1) ? v1 : Number(v1);
      let op = inOps.pop();
      let result = opMap[op].f(v1, v2);
      inValues.push([null, null, null, bc.ControlFactory.factoryOf(bc.STRING), result]);
    }
    let out = inValues.pop();
    // Hack - don't use value when your assigning to a pointer.  This should be done outside of evaluate.
    if (!(inType instanceof bc.control.Pointer)) {this.valueCheck(out)}

    return out[4];
  }
  // Build a new Control
  async executeBuild(inKey, inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    let type = inDesign.type;
    let cDesign = inDesign;
    let handler = inHandler ? inHandler : inInstance;

    let cFactory = this;
    let cInstance = cFactory.buildInstance(inInstance, cDesign);

    let step1Design = {};
    let step2Design = {};
    let hasStep2 = false;
    let cDef = cFactory.fullDefinition;

    // Split design between properties and children.
    for (let key in cDesign) {
      if (key == 'type' || key == 'id') {}
      else if (cDef.childMap[key]) {step1Design[key] = cDesign[key]}
      else {hasStep2 = true; step2Design[key] = cDesign[key]}
    }
    if (Object.keys(step1Design).length > 0) await cFactory.executeDesignRecurse(inHandler, cInstance, step1Design, this, inInstance, inKey);
    let promise = cInstance.init(cDesign); if (promise instanceof Promise) await promise;
    let anchor = inInstance.childMap[inKey];
    if (anchor instanceof bc.control.Anchor) {
      delete inInstance.childMap[inKey]; // Delete anchor
      anchor.transferControl(cInstance);
    } else {console.error('Not an anchor inInstance:', inInstance, ' key:', inKey)}
    inInstance.factory.setField(inInstance, inKey, cInstance);
    if (hasStep2) await cFactory.executeDesignRecurse(inHandler, cInstance, step2Design, null, null, null);
    if (cInstance.env.isNew) {await cInstance.executeRules(cInstance.onCreate)}
    await cInstance.executeRules(cInstance.onInitialized);
    return cInstance;
  }
  async executeDesignRecurse2(inKey, inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    let handler = inHandler ? inHandler : inInstance;  // Use current object as handler if non is passed in.
    let definition = this.fullDefinition;
    let child = this.getField(inInstance, inKey);
    let cFactory = child[0];
    if (cFactory == null) console.error ('No Factory - inKey:', inKey, ' factory:', this);
    let cType = cFactory.name;
    let cInstance = child[1];
    let cMod = child[2];
    let cDesign = inDesign[inKey];
    // Hack - If child is not a control instance then make the parent the handler.  This are for "light weight" components that can't process events.
    let outHandler = (cInstance instanceof bc.control.Control) ? inHandler : handler;
    if (typeof cDesign == 'string' && cFactory.fullDefinition.name != 'String' && cType != bc.STRING && cType != bc.DATA && cType != bc.RULES) {cDesign = bc.world.compileString(cDesign) }  // Deprecated
    if (cType == bc.DATA || cType == bc.RULES) {
      // If property type is rules or data then don't process and just pass to action or field.
      cInstance = cDesign;
      if (cMod == bc.ACTION) {await this.handleAction(inInstance, inKey, cDesign, cInstance, outHandler)}
      else this.setField(inInstance, inKey, cDesign) }
    else if (Array.isArray(cDesign)) {
      // If the property design is an array then its a formula so evaluate it and set it to the property or execute an action.
      cInstance = await outHandler.factory.evaluate(outHandler, cDesign, this, inInstance, cInstance);
      if (cMod == bc.ACTION) {await this.handleAction(inInstance, inKey, cDesign, cInstance, outHandler)}
      else {this.setField(inInstance, inKey, cInstance)}
    }
    else if (typeof cDesign == 'object') {
      // If the property design is an object then continue execution of the cDesign.  If action then execute the cDesign result.
      await cFactory.executeDesignRecurse(outHandler, cInstance, cDesign, this, inInstance, inKey);
      if (cMod == bc.ACTION) {await this.handleAction(inInstance, inKey, cDesign, cInstance, outHandler)}
      else if (cInstance instanceof bc.control.Control) {await this.handlePromise(cInstance.update(cDesign))}
    }
    else {
      // If the property design is a value then set the property to the value.
      if (cMod == bc.ACTION) {await this.handleAction(inInstance, inKey, cDesign, cDesign, outHandler)}
      else {this.setField(inInstance, inKey, cDesign)}
    }
  }
  async iterateRulesAsync(inHandler, inInstance, inRules) {
    for (let rI = 0, rLen = inRules.length; rI < rLen; rI++) {
      await this.executeDesignRecurse(inHandler, inInstance, inRules[rI], null, null, null);
    }
  }
  // Check for objects to be created and place anchor objects as place holders
  // This is so that objects at the same level know there "will" be an object
  // instantiated at some point so pathing doesn't fail.
  buildPreAnchors(inInstance, inDesign) {
    for (let key in inDesign) {
      let cDesign = inDesign[key];
      if (typeof cDesign == 'object' && cDesign.type) {
        if (!cDesign.id) cDesign.id = key;
        let child = this.getField(inInstance, key);
        let cFactory = child[0];
        let cInstance = child[1];
        let cType = cFactory.name;
        if (cType != bc.DATA && cType != bc.RULES) {
          if (cInstance != null) {
            if (cInstance instanceof bc.control.Anchor) {console.error('cInstance is an Anchor?? key:', key, ' cInstance:', cInstance)}
            else {cInstance.remove()}
          }
          let anchor = bc.ControlFactory.newInstance('Anchor', inInstance, {id:key, type:'Anchor'})
          inInstance.childMap[key] = anchor;
        }
      }
    }
  }

  // This is the magical core of the operation.  Messy... very Messy.
  async executeDesignRecurse(inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    if (Array.isArray(inDesign)) {
      // If the design is an array then it is a set of rules so process them in order.
      await this.iterateRulesAsync(inHandler, inInstance, inDesign);
    }
    else {
      // The design must be an object then so execute each property in the object.
      this.buildPreAnchors(inInstance, inDesign);
      // Execute all child keys ascync.
      let promises = [];
      for (let key in inDesign) {
        const cDesign = inDesign[key];
        let instance = inInstance;
        let factory = this;
        // If the object has a type then execute building the object unleass it has a design key (within collections).
        // Hack - ignore key design and instanceof bc.control.Design.  Fix by checking for property type.
        if (key != 'design' && typeof cDesign === 'object' && cDesign.type) {
          let factory = bc.ControlFactory.factoryOf(cDesign.type);
          if (!factory) {console.error('Can not build ', cDesign.type, ' at ', instance.localId, ' instance:', instance); debugger;}
          else {
            let promise = factory.executeBuild(key, inHandler, instance, cDesign, inPFactory, inPInstance, inPKey);
            promises.push(promise);
          }
        }
        else {
          let cDef = this.fullDefinition.childMap[key];
          if (!cDef) {
            if (inInstance instanceof bc.control.Control) {
              let cInstance = null;
              while (instance) {
                let anchor = instance.childMap[key];
                if (anchor instanceof bc.control.Anchor) {await anchor.waitForFinish()};
                const child = instance.factory.getField(instance, key);
                const cFactory = child[0];
                const cType = cFactory.name;
                const cInstance = child[1];
                const cMod = child[2];
                if (cInstance != undefined) {break}
                else {instance = instance.parent}
              }
            }
            if (!instance) {
              console.error('no instance for key:', key, ' inInstance:', inInstance, ' factory:', this, ' inDesign:', inDesign, ' inPInstance:', inPInstance);
              debugger;
            }
            factory = instance.factory;
          }
          let promise = factory.executeDesignRecurse2(key, inHandler, instance, inDesign, inPFactory, inPInstance, inPKey);
          promises.push(promise);
        }
      }
      let answer = await Promise.all(promises);
    }
  }
};
bc.control.Control = class {
  order = -1;
  constructor(parent, design) {
    this.id = design.id;
    this.parent = parent;
//if (this.parent instanceof bc.control.Anchor) console.error('id:', this.localId, ' parent is Anchor!')
  }
  get id() {return this._id}
  set id(inId) {this._id = inId}
  get type() {return this.factory.fullDefinition.name}
  // This must be used instead of type in script because type will trigger an object build.
  get class() {return this.factory.fullDefinition.name}
  get empty() {return ''} // The system wide value for no value.
  get ref() {return this}
  get childMap() {if (!this._childMap) {this._childMap = {}} return this._childMap}
  get identity() {return bc.world.agent.user}
  get world() {return bc.world}
  get processor() {return this.parent.processor}
  get env() {return this.parent.env}
  get concept() {return this.parent.concept}
  get area() {return this.parent.area}
  get me() {return this}
  get server() {return bc.socket}
  get fullId() {return this.parent.fullId + '.' + this.id}
  get localId() {if (this.parent == null) {console.error('parent null at:', this.id); console.trace(); return null}; let parentId = this.parent.localId; return parentId ? parentId + '.' + this.id : this.id}
  get environmentId() {return this.env.fullId}
  init(inDesign) {}
  update(inDesign) {}
  set onInitialized(inDetail) {this._onInitialized = inDetail}
  get onInitialized() {return this._onInitialized}
  // Called by the handler if it's being removed.
  removeHandler() {
    let handler = this.handler;
    if (handler) {
      handler.ref.removeClient(this);
      this.handler = null;
    }
  }

  get current() {return this}
  addListener(inType, inListener) {
    if (!this.listenerMap) this.listenerMap = {};
    let listener = this.listenerMap[inType];
    if (!listener) listener = this.listenerMap[inType] = [];
    listener.push(inListener);
    return inListener;
  }
  removeListener(inType, inListener) {
    let listener = this.listenerMap[inType];
    if (listener) {
      for (let lI = 0; lI < listener.length; lI++)
        if (listener[lI] === inListener) listener.splice(lI--, 1);
    }
  }
  async notifyListeners(type, inDesign) {
    let target = this.handler ? this.handler : this;
    if (!target.listenerMap) return null;
    let listener = target.listenerMap[type];
    if (listener) {
      for (let lI = 0; lI < listener.length; lI++) {await listener[lI](inDesign)}
    }
  }

  // Execute a local set of commands.  Remember rules will start at this and not inHandler.
  async doAction(inDesign, inDetail, inHandler) {
    await this.factory.executeDesignRecurse(inHandler, this, inDetail, null, null, null);
  }
  get doFindChild() {return bc.ControlFactory.newInstance('FindChild', this, {id:name, type:'FindChild'})}
  async doFindChildAction(inDesign, inDetail, inHandler) {
    inDetail.parent = inHandler;
    let current = this.childMap[inDetail.value];
    let design = current == null ? inDesign.onFalse : inDesign.onTrue;
    inDetail.current = current;
    await inDetail.executeRules(design);
    inDetail.remove();
  }
  doRemoveAction(inDesign, inDetail) {
    this.remove()
  }
  get doIf() {return {}}
  async doIfAction(inDesign, inDetail, inHandler){
    let design = inDetail.value ? inDesign.onTrue : inDesign.onFalse;
    await this.executeRules(design);
  }
  async isValue(inDesign, inInstance, inChildInstance, inPFactory, inPInstance, inPKey, inOutHandler) {
    await this.executeRules(inDesign[inInstance])}

  buildDesignFromPath(inPath, index) {
    let design = inPath[index];
    while (index > 0) {
      let key = inPath[--index];
      let newDesign = {};
      newDesign[key] = design;
      design = newDesign;
    }
//console.log('design:', design);
    return design;
  }
  async doWaitAction(inDesign, inDetail) {
    let process = this.processor.newProcess({name:'doWait'});
    let now = Date.now();
    let toTime = now + inDetail;
    do {now = await process.tickWait()} while (now > 0 && now < toTime);
    this.processor.removeProcess(process);
  }
  // Iterate through a control list and call associated rules on each control
  async iterateControlsWithRules(inControls, inRules) {
    if (inRules) {
      for (let cI = 0, cLen = inControls.length; cI < cLen; cI++) {
        this.current = inControls[cI];
        await this.executeRules(inRules);
      }
    }
  }
  // Sets the handler to null so that each object acts like the handler itself.
  // This is for controls that are executed without a handler like environments and
  // include concepts.  Many ideas but no solutions for this yet.
  async executeDesignHack(inDesign) {
    if (inDesign == null) inDesign = {};
      await this.factory.executeDesignRecurse(null, this, inDesign, null, null, null);
      await this.factory.handlePromise(this.update(inDesign));
  }
  async executeDesign(inDesign) {
    if (inDesign == null) inDesign = {};
      await this.factory.executeDesignRecurse(this, this, inDesign, null, null, null);
      await this.factory.handlePromise(this.update(inDesign));
  }
  // Execute an event imediately unless there is a handler.  This is used to avoid locking the stack on cyclical waits.
  async executeEvent(inEvent) {
    inEvent.control = inEvent.control == null ? this : inEvent.control;
    if (this.handler) {
      await this.handler.ref.sendEvent(inEvent);
    }
    else {
      await this.processXXX(inEvent);
    }
  }
  async executeRules(inRules) {
    if (inRules) {await this.factory.executeDesignRecurse(this, this, inRules, null, null, null)}
  }
  async sendEvent(inEvent) {
    inEvent.control = inEvent.control == null ? this : inEvent.control;
    if (this.handler) {
      inEvent.event = this.handler.ref.childMap[inState];
      await this.handler.ref.sendEvent(inEvent);
    }
    else {
      await this.addXXXEvent(inEvent);
    }
  }
  async resolveDesign(inHandler, inDesign) {
    let design = await inHandler.factory.resolveDesignRecurse(inHandler, inHandler.factory, inDesign);
    return design;
  }
  toDesignFromDetail(inMode, inDesign) {return this.factory.toDesignFromDetailRecurse(this, inMode, inDesign)}
  // Hack - Automatically set handlers instance.  This is a way for things attached to handler to know
  // the current instance.
  get handler() {
//    if (this._handler) {this._handler.ref.current = this}
    return this._handler
  };
  // When a handler is added then tell old handler to remove this as a client.
  set handler(inDetail) {
    if (this._handler) this._handler.ref.removeClient(this);
    this._handler = inDetail;
    if (inDetail != null) this._handler.ref.addClient(this);
  }
  // Rename a control based on input string.  If string is null assign a unique name.
  doRenameAction(inDesign, inDetail) {
    let oldId = this.id;
    let id = inDetail;
    let parentChildMap = this.parent.childMap;
console.log('id:', this.id, ' children:', this.parent.childMap);
    if (inDetail == '') {
      id = this.id;
      let i = 0;
      while (parentChildMap[id+i]) {i++}
      id = id + i;
    }
    this.id = id;
    delete parentChildMap[oldId];
    parentChildMap[id] = this;
console.log('doRenameAction - name:', id);
  }
  doReparentAction(inDesign, inDetail) {
    let targetChildMap = inDetail.ref.childMap;
    if (!targetChildMap) targetChildMap = inDetail.ref.childMap = {};
    delete this.parent.childMap[this.id];
    let id = this.ref.id;
    if (targetChildMap[id]) {
      let parts = id.split('__');
      if (parts.length > 1) {parts.pop()}
      this.ref.id = id = parts.join('__') + '__' + this.world.uuid++
    }
    targetChildMap[id] = this.ref;
    this.parent = inDetail.ref;
    inDetail.ref.object3D.add(this.ref.object3D);
//console.log('inDetail:', inDetail.ref);
  }
  get children() {
    let children = [];
    let childMap = this.childMap;
    if (childMap) {
      let keys = Object.keys(childMap);
      for (let cI = 0, cLen = keys.length; cI < cLen; cI++) children.push(childMap[keys[cI]]);
    }
    return children;
  }
  // If a child's parent is this then remove it.
  removeChild(child) {
    if (!child) return;
    if (child.parent !== this) {} else child.remove();
  }
  remove() {
    this.listenerMap = null;
    let childMap = this.childMap;
    for (var key in childMap) {this.removeChild(childMap[key])}
    this.removeHandler(this);
    if (this.parent && this.parent.childMap[this.id] === this) {delete this.parent.childMap[this.id]}
    this.parent = null;
  }
  static get definition() {return{name:'Control', type:bc.CLASS, childMap:{
    area:{type:'Area', mod:bc.TRAIT, description:'Returns parent area control'},
    empty:{type:bc.STRING, mod:bc.TRAIT, description:'The system wide representation for no value'},
    class:{type:bc.STRING, mod:bc.TRAIT, description:'Control Type'},
    current:{type:bc.CONTROL, mod:bc.TRAIT, description:'Current control'},
    children:{type:bc.ARRAY, mod:bc.TRAIT, description:'DEPRECATED - Array of all children'},
    event:{type:'_Event', mod:bc.FIELD, description:'Event parameters'},
    eventUser:{type:bc.CONTROL, mod:bc.TRAIT, description:'User sending the event'},
    concept:{type:'Concept', mod:bc.TRAIT, description:'Returns parent concept control'},
    data:{type:bc.DATA, mod:bc.FIELD, order:2, description:'Used to attach non-descript data elements to the object'},
    doAddChild:{type:bc.CONTROL, mod:bc.ACTION, description:'Adds the given control as a child'},
    doFindChild:{type:'FindChild', mod:bc.ACTION, description:'Execute onTrue if child found otherwise onFalse'},
    doChildLoop:{type:'Rules', mod:bc.ACTION, description:'DEPRECATED - Loop through all children'},
    doRename:{type:bc.STRING, mod:bc.ACTION, description:'Rename control with given name or unique name if empty'},
    doRemove:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Remove this control'},
    doReparent:{type:bc.CONTROL, mod:bc.ACTION, description:'Change controls parent'},
    do:{type:bc.RULES, mod:bc.ACTION, description:'run rules localy'},
    env:{type:'Environment', mod:bc.TRAIT, description:'Returns parent environment control'},
    environmentId:{type:bc.STRING, mod:bc.TRAIT, description:'Address of environment'},
    handler:{type:bc.CONTROL, mod:bc.FIELD, order:1, description:'Assigns the handler that will listen on this control.'},
    id:{type:bc.STRING, mod:bc.FIELD, description:'unique identifier of this control.  Can not conflict with property or child names.'},
    identity:{type:bc.CONTROL, mod:bc.TRAIT, description:'returns the identity control'},
    localId:{type:bc.STRING, mod:bc.TRAIT, description:'A local area name for the control'},
    me:{type:bc.CONTROL, mod:bc.TRAIT, description:'DEPRECATED - return this'},
    order:{type:bc.INTEGER, mod:bc.FIELD, default:-1, order:0, description:'A value used by several operations to determine order of control.'},
    onCreated:{type:bc.RULES, mod:bc.FIELD, order:100, description:'DEPRECATED - Executed only when a fresh script is run that doesnt have a state yet'},
    onCreate:{type:bc.RULES, mod:bc.FIELD, order:102, description:'Called only when the environment is created'},
    onInitialized:{type:bc.RULES, mod:bc.FIELD, order:101, description:'Executed when control is finished loading'},
    parent:{type:bc.CONTROL, mod:bc.TRAIT, description:'parent of this control'},
    world:{type:bc.CONTROL, mod:bc.TRAIT, description:'world control'},
    doWait:{type:bc.INTEGER, mod:bc.ACTION, description:'Wait for a given number of milliseconds'},
    doIf:{type:'_DoIf', mod:bc.ACTION, description:'Execute if construct'},
  }, description:'A base class used to derive most complex classes used as building blocks for the scripting language'}}
}
bc.ControlFactory.newFactory(bc.control.Control);
bc.control.Control3D = class extends bc.control.Control {
  constructor(parent, detail) {
    super(parent, detail);
    this.object3D = new THREE.Group();
  }
  set object(inDetail) {console.error('Setting Object in id:', this.localId,); this.object3D = inDetail}
  get object() {return this.object3D}
  assignMat(mesh, material) {mesh.traverse((child)=>{if (child instanceof THREE.Mesh) child.material = material})}
  assignColor(mesh, color) {
    mesh.traverse((child)=>{
      if (child instanceof THREE.Mesh && child.material && child.material.color)
        {child.material.color = child.material.emissive = color}
    });
  }
  cloneMesh(inObject) {
    var copyObject = null;
    if (inObject instanceof THREE.Group) {
      copyObject = new THREE.Group();
    } else if (inObject instanceof THREE.Mesh) {
      copyObject = new THREE.Mesh(inObject.geometry, inObject.material);
    } else {
      return null;
    }
    for (var i = 0; i < inObject.children.length; i++) {
      var childObject = inObject.children[i];
      var copyChildObject = this.cloneMesh(childObject);
      if (copyChildObject != null)
        copyObject.add(copyChildObject);
    }
    return copyObject;
  }
  // Hack - hack for scripting.  Needs to be in Traits
  get locationTrait() {
    let position = new THREE.Vector3();
    this.object3D.getWorldPosition(position);
    let px = Math.round(position.x*1000)/1000;
    let py = Math.round(position.y*1000)/1000;
    let pz = Math.round(position.z*1000)/1000;
    let rx = Math.round(this.object3D.rotation.x*1000)/1000;
    let ry = Math.round(this.object3D.rotation.y*1000)/1000;
    let rz = Math.round(this.object3D.rotation.z*1000)/1000;
    return ({position:{x:px, y:py, z:pz}, rotation:{x:rx, y:ry, z:rz}});
  }
  doLookAtAction(inDesign, inDetail) {
    let target = new THREE.Vector3();
    inDetail.object.getWorldPosition(target);
    this.object3D.lookAt(target);
  }
  get geometryBox() {
    return this.geometry ? this.geometry.ref.box : {min:{x:0, y:0, z:0}, max:{x:0, y:0, z:0}}
  }
  get size() {
    let box = this.geometryBox;
    let minX = box.min.x, minY = box.min.y, minZ = box.min.z, maxX = box.max.x, maxY = box.max.y, maxZ = box.max.z;
    let childMap = this.childMap;
    for (let key in childMap) {
      let child = childMap[key];
      if (child instanceof bc.control.Control3D) {
        let size = child.size;
        let p = child.object3D.position;
        minX = Math.min (minX, p.x - size.x / 2);
        minY = Math.min (minY, p.y - size.y / 2);
        minZ = Math.min (minZ, p.z - size.z / 2);
        maxX = Math.max (maxX, p.x + size.x / 2);
        maxY = Math.max (maxY, p.y + size.y / 2);
        maxZ = Math.max (maxZ, p.z + size.z / 2);
      }
    }
    let s = this.object3D.scale;
    let size = new THREE.Vector3((maxX - minX)*s.x, (maxY - minY)*s.y, (maxZ - minZ)*s.z);
    return size;
  }
  remove() {
    if (this.object3D && this.object3D.parent) this.object3D.parent.remove(this.object3D);
//    if(this.parent && this.parent.object3D) this.parent.object3D.remove(this.object3D);
    this.env.removeIntersectable(this);
    super.remove();
  }
  get worldPosition() {
    let position = new THREE.Vector3();
    this.object3D.getWorldPosition(position);
    return new THREE.Vector3(position.x, position.y, position.z);
  }
  // Add intersectable to environment list.
  setIntersectable() {
    this.env.addIntersectable(this);
  }
  static get definition() {return{name:'Control3D', type:bc.CLASS, childMap:{
    doLookAt:{type:bc.CONTROL, mod:bc.ACTION, description:'Look At Object'},
    object:{type:'_Object3D', mod:bc.FIELD, description:'The underlying 3D object interface'},
    locationTrait:{type:'_Location', mod:bc.TRAIT, description:'DEPRECATED - HACK'},
    size:{type:'_Vector', mod:bc.TRAIT, description:'Size of object. Move this to a util interface.'},
    worldPosition:{type:'_Vector', mod:bc.TRAIT, description:'HACK'}
  }, description:'A base control inherited by other controls that contains 3D graphical information.'}}
}
bc.ControlFactory.newFactory(bc.control.Control3D);
bc.PrimeControlFactory = class extends bc.ControlFactory {
  constructor(inClass) {super(inClass)}
  // A stripped down version of the ControlFactory copy is used because
  // we don't need all the fluff that the wrapper factories need.
  toDesignFromDetail(inInstance, inMode, inDesign) {
    let design = {};
    let keyCount = 0;
    let defMap = this.fullDefinition.childMap;
    for (let key in defMap) {
      let cDef = defMap[key];
      let cType = cDef.type;
      let diffDesign = null;
      if (inDesign) diffDesign = inDesign[key];
      let cInstance = inInstance[key];
      if (cInstance == null) {}
      else {
        let cFactory = bc.ControlFactory.factoryOf(cType);
        if (cInstance != null && typeof cInstance === 'object') {
          if (cInstance.parent) {
            console.warn('inInstance:', inInstance.localId, ' cInstance.parent:', cInstance.parent.localId);
          }
          else {
            let cDesign = cFactory.toDesignFromDetail(cInstance, inMode, diffDesign);
            if (cDesign != null) {design[key] = cDesign; keyCount++}
          }
        }
        else {
          if (diffDesign != null) {
            if (cInstance !== diffDesign) {design[key] = cInstance; keyCount++}
          }
          else if (cDef.default !== cInstance) {design[key] = cInstance; keyCount++}
        }
      }
    }
    if (!keyCount) {design = null}
    return design;
  }

  // Return a basic object unless a factory overides it.
  build(inDesign) {return {}}
}
bc.PrimitiveFactory = class extends bc.PrimeControlFactory {
  constructor(inClass) {super(inClass)}
  async executeDesignRecurse2(inKey, inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    let instanceClass = this.instanceClass;
    if (this.instanceClass.definition.childMap[inKey].mod == bc.ACTION) {
      await this[inKey+'Action'](inDesign[inKey], inInstance, inHandler, inPFactory, inPInstance, inPKey);
    } else {
      this[inKey](inDesign[inKey], inInstance, inHandler);
    }
  }
  async isValueAction(inDesign, inInstance, inHandler) {
    await inHandler.executeRules(inDesign[inInstance])
  }
  async doAnimationAction(inDesign, inInstance, inHandler, inPFactory, inPInstance, inPKey) {
    let count = 0, name;
    let instance = bc.ControlFactory.newInstance('DoAnimation', this, {id:name, type:'DoAnimation'});
    instance.parent = inHandler;
    instance.current = inHandler.current;
    let factory = bc.ControlFactory.factoryOf('DoAnimation');
    await factory.executeDesignRecurse(inHandler, instance, inDesign, null, null, null);
    this.doAnimationPromise(instance, inPFactory, inPInstance, inPKey);
  }
  async doAnimationPromise(inDetail, inPFactory, inPInstance, inPKey) {
    let current = this.current;
    let ease = inDetail.ease ? inDetail.ease : 0;
    let fromTime = inDetail.fromTime ? inDetail.fromTime : 0;
    let toTime = inDetail.toTime ? inDetail.toTime : fromTime;
    let to = inDetail.to ? inDetail.to : 0;
    let from = inDetail.from ? inDetail.from : 0;
    let startFrame = Math.floor(fromTime / 16.6666);
    let endFrame = Math.floor(toTime / 16.6666);
    let distance = to - from;
    let duration = toTime - fromTime;
    let value = 0;
    let isBusy = false;
    let now = Date.now();
    fromTime += now; toTime += now;

    let processor = bc.world.activeEnv;
    let process = processor.newProcess({type:'animate'});
    while (now != toTime) {
      now = await process.tickWait();
      if (now > toTime || now < 0) now = toTime;
      if (now >= fromTime) {
        let t = duration ? 1 - (toTime - now) / duration : 1;
        if (ease == 0) {value = distance * t + from}
        else if (ease == 1) {value = distance * t * t + from} // easeInQuad
        else if (ease == 2) {value = distance * t * t * t + from}  // easeInCubic
        else if (ease == 3) {value = distance * (t * (2 - t)) + from}  // easeOutQuad
        else if (ease == 4) {value = distance * ((t - 1) * (t - 1) * (t - 1) + 1) + from} // easeOutCubic
        else if (ease == 5) {value = distance * (t < .5 ? 2*t*t : -1+(4-2*t)*t) + from} // easeInOutQuad
        else if (ease == 6) {value = distance * (t < .5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1) + from} // easeInOutCubic
        inPFactory.setField(inPInstance, inPKey, value);
        if (inDetail.onTick) {await inDetail.executeRules(inDetail.onTick)}
      }
    }
    if (inDetail.onTime) {await inDetail.executeRules(inDetail.onTime)}
    processor.removeProcess(process);
  }
  static get definition() {return {name:'PrimitiveFactory', type:bc.CLASS, childMap:{
  }, description:'Primitive factory'}}
},
bc.PrimeDoIfFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeDoIfFactory)}
  static get definition() {return {name:'_DoIf', type:bc.CLASS, childMap:{
    value:{type:bc.FLOAT, mod:bc.FIELD, order:10, description:'Equation to test true or false against'},
    onTrue:{type:bc.DATA, mod:bc.FIELD, order:11, description:'Executed when equation is true'},
    onFalse:{type:bc.DATA, mod:bc.FIELD, order:12, description:'Executed when equation is false'},
  }, description:'Execute onTrue or onFalse based on value'}}
}
bc.ControlFactory.addFactory(new bc.PrimeDoIfFactory());
bc.control.DoDelay = class extends bc.control.Control {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  static get definition() {return {name:'DoDelay', type:bc.CLASS, childMap:{
    time:{type:bc.INTEGER, mod:bc.FIELD}, onTick:{type:bc.RULES, mod:bc.FIELD},
    onTime:{type:bc.RULES, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(bc.control.DoDelay);
bc.control.DoAnimation = class extends bc.control.Control {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  static get definition() {return {name:'DoAnimation', type:bc.CLASS, childMap:{
    ease:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Selects the type of easing used in animation'},
    from:{type:bc.FLOAT, mod:bc.FIELD, default:0, description:'Denotes the starting value'},
    to:{type:bc.FLOAT, mod:bc.FIELD, default:0, description:'Denotes the ending value'},
    onTick:{type:bc.RULES, mod:bc.FIELD, description:'Executed every frame'},
    onTime:{type:bc.RULES, mod:bc.FIELD, description:'Executed once animation is finished'},
    fromTime:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Denotes the starting time of animation'},
    toTime:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Denotes the ending time of animation'}
  }, description:'Animation parameters'}}
}
bc.ControlFactory.newFactory(bc.control.DoAnimation);
bc.control.DoAnimate = class extends bc.control.Control {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  static get definition() {return {name:'DoAnimate', type:bc.CLASS, childMap:{
    value:{type:bc.STRING, mod:bc.FIELD, description:'Path of property to animate'},
    ease:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Selects the type of easing used in animation'},
    from:{type:bc.FLOAT, mod:bc.FIELD, default:0, description:'Denotes the starting value'},
    to:{type:bc.FLOAT, mod:bc.FIELD, default:0, description:'Denotes the ending value'},
    onTick:{type:bc.RULES, mod:bc.FIELD, description:'Executed every frame'},
    onTime:{type:bc.RULES, mod:bc.FIELD, description:'Executed once animation is finished'},
    fromTime:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Denotes the starting time of animation'},
    toTime:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Denotes the ending time of animation'},
    now:{type:bc.FLOAT, mod:bc.TRAIT, description:'Current value of animated number'}
  }, description:'Animation parameters'}}
}
bc.ControlFactory.newFactory(bc.control.DoAnimate);
bc.PrimeEventFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeEventFactory)}
  static get definition() {return {name:'_Event', type:bc.CLASS, childMap:{
    user:{type:bc.CONTROL, mod:bc.FIELD, description:'user that sent the event'},
    state:{type:bc.STRING, mod:bc.FIELD, description:'event state'},
    key:{type:bc.STRING, mod:bc.FIELD, description:'key pressed if key event'}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeEventFactory());
bc.PrimeDoUpdateNotifyFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeDoUpdateNotifyFactory)}
  static get definition() {return {name:'_DoUpdateNotify', type:bc.CLASS, childMap:{current:{type:bc.CONTROL, mod:bc.FIELD}}}}
}
bc.ControlFactory.addFactory(new bc.PrimeDoUpdateNotifyFactory());
bc.PrimeControlMapFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeControlMapFactory)}
  static get definition() {return {name:'_ControlMap', type:bc.CLASS, description:'An array of Controls'}}
}
bc.ControlFactory.addFactory(new bc.PrimeControlMapFactory());
bc.PrimeARRAYFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeARRAYFactory)}
  async executeDesignRecurse2(inKey, inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    await this[inKey+'Action'](inInstance, inDesign[inKey], inHandler);
  }
  async doLoopAction(inInstance, inRules, inHandler) {
    let controls = inInstance;
    let rules = Array.isArray(inRules) ? inRules : [inRules];
    if (rules && rules.length > 0) {
      let instance = bc.ControlFactory.newInstance('DoIterate', this, {id:'iterate', type:'DoIterate'});
      instance.parent = inHandler;
      for (let cI = 0, cLen = controls.length; cI < cLen; cI++) {
        instance.current = controls[cI];
        await instance.executeRules(rules);
      }
    }
  }
  static get definition() {return {name:bc.ARRAY, type:bc.CLASS, childMap:{
    doLoop:{type:bc.RULES, mod:bc.ACTION},
    description:'Primitive ARRAY of controls'
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeARRAYFactory());
bc.PrimeFLOATFactory = class extends bc.PrimitiveFactory {
  constructor() {super(bc.PrimeFLOATFactory)}
  static get definition() {return {name:bc.FLOAT, type:bc.CLASS, childMap:{
    doAnimation:{type:'DoAnimation', mod:bc.ACTION},
    isValue:{type:bc.DATA, mod:bc.ACTION}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeFLOATFactory());
bc.PrimeINTEGERFactory = class extends bc.PrimitiveFactory {
  constructor() {super(bc.PrimeINTEGERFactory)}
  static get definition() {return {name:bc.INTEGER, type:bc.CLASS, childMap:{
    doAnimation:{type:'DoAnimation', mod:bc.ACTION},
    isValue:{type:bc.DATA, mod:bc.ACTION}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeINTEGERFactory());
bc.PrimeBOOLEANFactory = class extends bc.PrimitiveFactory {
  constructor() {super(bc.PrimeBOOLEANFactory)}
  static get definition() {return {name:bc.BOOLEAN, type:bc.CLASS, description:'Primitive BOOLEAN value',
    childMap:{doAnimation:{type:'DoAnimation', mod:bc.ACTION},isValue:{type:bc.DATA, mod:bc.ACTION}}}}
}
bc.ControlFactory.addFactory(new bc.PrimeBOOLEANFactory());
bc.PrimeDATAFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeDATAFactory)}
  setField(inInstance, inKey, inDetail) {inInstance[inKey] = inDetail}
  getField(inInstance, inKey) {
    let value = inInstance[inKey];
    let type = null;
    if (typeof value == 'string') {type = bc.STRING}
    else if (typeof value == 'object') {type = bc.DATA}
    else {type = bc.FLOAT}
    return [bc.ControlFactory.factoryOf(type), inInstance[inKey], bc.FIELD]
  }
  static get definition() {return {name:bc.DATA, type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.addFactory(new bc.PrimeDATAFactory());
bc.PrimeRULESFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeRULESFactory)}
  static get definition() {return {name:bc.RULES, type:bc.CLASS, description:'A Series of instructions executed against the current control',
    childMap:{}}}
}
bc.ControlFactory.addFactory(new bc.PrimeRULESFactory());
bc.PrimePaddingFactory = class extends bc.PrimeControlFactory {
  top = .1; left = .1; right = .1; bottom = .1;
  constructor() {super(bc.PrimePaddingFactory)}
  static get definition() {return {name:'Padding', type:bc.CLASS, childMap:{
    top:{type:bc.FLOAT, mod:bc.FIELD, default:.1},
    left:{type:bc.FLOAT, mod:bc.FIELD, default:.1},
    right:{type:bc.FLOAT, mod:bc.FIELD, default:.1},
    bottom:{type:bc.FLOAT, mod:bc.FIELD, default:.1}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimePaddingFactory());
bc.PrimeLocationFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeLocationFactory)}
  build(inDesign) {
    let p = inDesign.position;
    let r = inDesign.rotation;
    return {position:new THREE.Vector3(p.x, p.y, p.z), rotation:new THREE.Vector3(r.x, r.y, r.z)}
  }
  static get definition() {return {name:'_Location', type:bc.CLASS, childMap:{
    position:{type:'_Vector', mod:bc.FIELD}, rotation:{type:'_Vector', mod:bc.FIELD}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeLocationFactory());
bc.PrimeBoxFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeBoxFactory)}
  static get definition() {return {name:'_Box', type:bc.CLASS, childMap:{
    min:{type:'_Vector', mod:bc.FIELD}, max:{type:'_Vector', mod:bc.FIELD}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeBoxFactory());
bc.PrimeSTRINGFactory = class extends bc.PrimitiveFactory {
  constructor() {super(bc.PrimeSTRINGFactory)}
  getField(inInstance, inKey) {return this[inKey](inInstance)}
  toLowerCase(inInstance) {return [bc.ControlFactory.factoryOf(bc.STRING), inInstance.toLowerCase(), bc.TRAIT];}
  trimLastChar(inInstance) {
    return [bc.ControlFactory.factoryOf(bc.STRING), inInstance.substr(0, inInstance.length-1), bc.TRAIT];
  }
  length(inInstance) {return [bc.ControlFactory.factoryOf(bc.INTEGER), inInstance.length, bc.TRAIT]}
  static get definition() {return {name:bc.STRING, type:bc.CLASS, childMap:{
    toLowerCase:{type:bc.STRING, mod:bc.TRAIT},
    trimLastChar:{type:bc.STRING, mod:bc.TRAIT},
    length:{type:bc.INTEGER, mod:bc.TRAIT},
    isValue:{type:bc.DATA, mod:bc.ACTION}
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeSTRINGFactory());
bc.THREEJSVectorFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.THREEJSVectorFactory)}
  static get definition() {return {name:'_Vector', type:bc.CLASS, childMap:{
    x:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    y:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    z:{type:bc.FLOAT, mod:bc.FIELD, default:0}}}
  }
  build(inDesign) {return new THREE.Vector3(inDesign.x, inDesign.y, inDesign.z)}
}
bc.ControlFactory.addFactory(new bc.THREEJSVectorFactory());
bc.THREEJSEulerFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.THREEJSEulerFactory)}
  static get definition() {return {name:'_Euler', type:bc.CLASS, childMap:{
    order:{type:bc.STRING, mod:bc.FIELD, default:'XYZ'},
    x:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    y:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    z:{type:bc.FLOAT, mod:bc.FIELD, default:0}}}
  }
  build(inDesign) {return new THREE.Euler(inDesign.x, inDesign.y, inDesign.z, inDesign.order)}
}
bc.ControlFactory.addFactory(new bc.THREEJSEulerFactory());
bc.THREEJSScaleFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.THREEJSScaleFactory)}
  build(inDesign) {return new THREE.Vector3(inDesign.x, inDesign.y, inDesign.z)}
  static get definition() {return {name:'_Scale', type:bc.CLASS, childMap:{
    x:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    y:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    z:{type:bc.FLOAT, mod:bc.FIELD, default:1}}}
  }
}
bc.ControlFactory.addFactory(new bc.THREEJSScaleFactory());
bc.Object3DFactory = class extends bc.PrimeControlFactory {
  setters = {
    opacity:(inInstance, inDetail)=>{inInstance.traverse((child)=>{if (child instanceof THREE.Mesh && child.material) Object.assign(child.material, {opacity:inDetail})})},
    position:(inInstance, i)=>{let c = inInstance.position; c.x = i.x; c.y = i.y; c.z = i.z},
    rotation:(inInstance, i)=>{let c = inInstance.rotation; c.x = i.x; c.y = i.y; c.z = i.z},
    scale:(inInstance, i)=>{let c = inInstance.scale; c.x = i.x; c.y = i.y; c.z = i.z},
    scalar:(inInstance, i)=>{let c = inInstance.scale; c.x = i; c.y = i; c.z = i}
  };
  getters = {
    opacity:(inInstance)=>{
      let opacity = 1;
      inInstance.traverse((child)=>{if (child instanceof THREE.Mesh && child.material) {opacity = child.material.opacity}})
      return opacity;
    },
    direction:(inInstance)=>{
      let direction = new THREE.Vector3( 0, 0, -1 ).applyQuaternion(inInstance.quaternion ).normalize();
      return {x:direction.x, y:direction.y, z:direction.z};
    },
    scalar:(inInstance)=>{return inInstance.scale.x}
  }
  constructor() {super(bc.Object3DFactory)}
  setField(inInstance, inKey, inDetail) {
    if (inDetail instanceof bc.control.Control) inDetail = inDetail.ref;
    if (this.setters[inKey]) {this.setters[inKey](inInstance, inDetail)}
    else {super.setField(inInstance, inKey, inDetail)}
  }
  getField(inInstance, inKey) {
    if (this.getters[inKey]) {
      let def = this.fullDefinition.childMap[inKey];
      let value = this.getters[inKey](inInstance);
      return [bc.ControlFactory.factoryOf(def.type), value, def.mod];
    }
    else return super.getField(inInstance, inKey)
  }
  static get definition() {return {name:'_Object3D', type:bc.CLASS, childMap:{
      castShadow:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
      receiveShadow:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
      opacity:{type:bc.FLOAT, mod:bc.FIELD, default:1},
      position:{type:'_Vector', mod:bc.FIELD},
      renderOrder:{type:bc.INTEGER, mod:bc.FIELD, default:0},
      rotation:{type:'_Euler', mod:bc.FIELD},
      direction:{type:'_Vector', mod:bc.TRAIT},
      scalar:{type:bc.FLOAT, mod:bc.FIELD, default:1},
      scale:{type:'_Scale', mod:bc.FIELD},
      visible:{type:bc.BOOLEAN, mod:bc.FIELD, default:true},
    },  description:'rotation and position information'} }
}
bc.ControlFactory.addFactory(new bc.Object3DFactory());
bc.control.Geometry = class extends bc.control.Control {
  get box() {
    this.value.computeBoundingBox();
    let box = this.value.boundingBox;
    return {min:new THREE.Vector3(box.min.x, box.min.y, box.min.z), max:new THREE.Vector3(box.max.x, box.max.y, box.max.z)};
  }
  static get definition() {return {name:'Geometry', type:bc.CLASS, childMap:{box:{type:'_Box', mod:bc.TRAIT}}}}
}
bc.ControlFactory.newFactory(bc.control.Geometry);
bc.control.Material = class extends bc.control.Control {
  static get definition() {return {name:'Material', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.Material);
bc.control.Texture = class extends bc.control.Control {
  static get definition() {return {name:'Texture', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.Texture);
bc.control.DoIterate = class extends bc.control.Control {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  static get definition() {return {name:'DoIterate', type:bc.CLASS, childMap:{
    onNext:{type:bc.RULES, mod:bc.FIELD, description:'Rules to execute for each iteration'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.DoIterate);
bc.control.DoAsync = class extends bc.control.Control {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  static get definition() {return {name:'DoAsync', type:bc.CLASS, childMap:{
    onAction:{type:bc.RULES, mod:bc.FIELD, description:'Rules to execute for Async'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.DoAsync);
bc.control.FindChild = class extends bc.control.Control {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  static get definition() {return {name:'FindChild', type:bc.CLASS, childMap:{
    value:{type:bc.STRING, mod:bc.FIELD, order:10, description:'String name of child to find'},
    onTrue:{type:bc.DATA, mod:bc.FIELD, order:11, description:'Executed when equation is true'},
    onFalse:{type:bc.DATA, mod:bc.FIELD, order:12, description:'Executed when equation is false'},
  }, description:'Execute onTrue or onFalse based on value'}}
}
bc.ControlFactory.newFactory(bc.control.FindChild);
bc.control.World = class extends bc.control.Control {
  statusSize = 0;
  statusListeners = [];
  previousEnvironmentName = 'entry';
  keypressed = false;
  constructor(parent, design, sceneName, callback) {
    super(parent, {id:'_world'});
    this.factory = bc.ControlFactory.factoryOf('World'); // Hack - we don't use newControl so we need to add this.
    // Parsing structures need there own class eventually.
    this.ops = new Array(255);
    for (let oI = 0; oI < 255; oI++) this.ops[oI] = 0;
    let opChars = '+-/*><=!&|';
    for (let cI = 0, cLen = opChars.length; cI < cLen; cI++) {this.ops[opChars.charCodeAt(cI)] = 1}
    this.opMap = {
      '*':{o:15, f:function(l, r) {return l * r}}, '/':{o:15, f:function(l, r) {return l / r}},
      '+':{o:14, f:function(l, r) {return l + r}}, '-':{o:14, f:function(l, r) {return l - r}},
      '<':{o:12, f:function(l, r) {return l < r}}, '<=':{o:12, f:function(l, r) {return l <= r}},
      '>':{o:12, f:function(l, r) {return l > r}}, '>=':{o:12, f:function(l, r) {return l >= r}},
      '==':{o:11, f:function(l, r) {return l == r}}, '!=':{o:11, f:function(l, r) {return l != r}},
      '===':{o:11, f:function(l, r) {return l === r}}, '!==':{o:11, f:function(l, r) {return l !== r}},
      '&':{o:10, f:function(l, r) {return l & r}}, '^':{o:9, f:function(l, r) {return l ^ r}},
      '|':{o:8, f:function(l, r) {return l | r}}, '&&':{o:7, f:function(l, r) {return l && r}},
      '||':{o:6, f:function(l, r) {return l || r}}};
    this.keyboardModal = false; // Used by keyhandler to allow a modal operation
    this.designQueue = [];
    if (design.instanceUUID) this.instanceId = design.instanceUUID;
    else this.instanceId = this.generateUUID().substring(0,6);
    this.persist = design.persist;
    this.uuid = 0; // Can be used by anything as long as it's bumped each time.
    bc.world = this;
    design = this.design = this.toDesignFromJSON(design, []);
    if (design.instanceId) this.instanceId = design.instanceId;
    if (design.timeout) debugDelay = design.timeout;
    this.activeEnv = null;
    this.scene = this.object3D = new THREE.Scene();
    this.bootWorld({design:design, sceneName:sceneName}).then(()=>{callback()})

    // Hack - Move this to Identity?
    this.keyDownFunction = event=>{
      if (this.activeEnv) {
        this.key = event.key;
        if (!this.keypressed) {
          this.keypressed = true;
          this.activeEnv.notifyListeners(bc.KEYBOARD_EVENT, {key:event.key, mode:'down'}).then(()=>{
            this.activeEnv.notifyListeners(bc.KEYBOARD_EVENT, {key:event.key, mode:'pressed'});
          })
        } else {
          this.activeEnv.notifyListeners(bc.KEYBOARD_EVENT, {key:event.key, mode:'pressed'});
        }
      }
    };
    document.addEventListener('keydown', this.keyDownFunction);
    this.keyUpFunction = event=>{
      if (this.activeEnv) {
        this.key = event.key;
        this.keypressed = false;
        this.activeEnv.notifyListeners(bc.KEYBOARD_EVENT, {key:event.key, mode:'up'});
      }
    };
    document.addEventListener('keyup', this.keyUpFunction);
  }
  get env() {return this.activeEnv}
  get fullId() {return '_world'}
  get localId() {return '_world'}
  get processor() {return this};
  generateUUID(a) {return a ? (a ^ ((Math.random() * 16) >> (a / 4))).toString(16) : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, this.generateUUID)}
  get randomUUID() {return this.generateUUID()}
  get instanceUUID() {return this.instanceId}
  statusWait() {
    return new Promise((resolve, reject)=>{
      if (this.statusSize > 0) {this.addStatusListener((statusSize)=>{resolve(statusSize)})}
      else {resolve(this.statusSize)}
    })
  }
  addStatus(inAmount) {
    this.statusSize += inAmount;
    for (let sI = 0, sLen = this.statusListeners.length; sI < sLen; sI++) {this.statusListeners[sI](this.statusSize)}
    this.statusListeners.length = 0;
  }
  removeStatus(inAmount) {
    this.statusSize -= inAmount;
    for (let sI = 0, sLen = this.statusListeners.length; sI < sLen; sI++) {this.statusListeners[sI](this.statusSize)}
    this.statusListeners.length = 0;
  }
  remove() {
    document.removeEventListener('keydown', this.keyDownFunction);
    document.removeEventListener('keyup', this.keyUpFunction);
    super.remove()
  }
  addStatusListener(f) {this.statusListeners.push(f)}
  async bootWorld(inDesign) {
    let detail = this.detail;
    let design = inDesign.design;
    let timeOut = setTimeout(()=>{console.error('bootWorld Timed Out!!')}, debugDelay);

    // Hack - This code executes from Environment point of view so that handler is correct.
    // Not sure of fix yet.
    let globalDesign = JSON.parse(JSON.stringify(design._global))
    await this.executeDesign({_global:globalDesign});
//    delete globalDesign.type;
//    delete globalDesign.id;
//    await this.childMap._global.executeDesign(globalDesign);

    this.server.addListener('environment', async (inMessage)=>{
      let env = this.world.childMap[inMessage.anchorId];
      let envDesign = this.world.toStringFromDetail(env, bc.FULL_DESIGN);
      inMessage.anchorDocument = envDesign;
      this.server.directResponse(inMessage, {anchorId:inMessage.anchorId, anchorDocument:envDesign});
    });
    this.server.addListener('ExecuteAction', async (inMessage)=>{
      const userKey = inMessage.fromUserId;
      const env = this.activeEnv;
      const user = env.userMap[userKey];
      const actionPath = inMessage.actionId.split('.');
//console.log('ExecuteAction - actionPath:', actionPath);
      const actionRef = await env.factory.toValueFromPath(env, actionPath);
      const action = actionRef[4];
//console.log('ExecuteAction - action:', action);
      await action.factory.executeDesignRecurse(action, action, inMessage.rules, null, null, null);
      await action.executeRules(action.onAction);
    });
    const controllerQueue = [];
    // Listen for controller events from external users then queue up commands and execute one at a time
    this.server.addListener('UpdateController', async (inMessage)=>{
      const env = bc.world.activeEnv;
      const user = env.userMap[inMessage.fromUserId];
      if (!user) {console.log('No User ', inMessage.fromUserId); return;}
      const controllerId = inMessage.controllerId;
      const controller = user.controllerMap[controllerId];
      if (!controller) {console.log('No Controller User:', inMessage.fromUserId, ' Controller:', controllerId); return;}
      controller.message = inMessage;
      if (inMessage.actionId) {
        if (inMessage.controlId) {
          const controlPath = inMessage.controlId.split('.');
          const controlRef = await env.factory.toValueFromPath(env, controlPath);
          const control = controlRef[4];
          controller.control = control;
        }
        controller.actionMode = inMessage.actionMode;
        const actionPath = inMessage.actionId.split('.');
        const actionRef = await env.factory.toValueFromPath(env, actionPath);
        const action = actionRef[4];
        controller.action = action;
        await action.mimicController(controller);
      } else {
        if (inMessage.actionMode == 'Move') {
          controller.object.rotation.x = inMessage.rX;
          controller.object.rotation.y = inMessage.rY;
          controller.object.rotation.z = inMessage.rZ;
          const handler = controller.handler.ref;
          handler.current = controller;
          handler.executeRules(handler.onUpdate);
        }
      }
    })
    this.server.addListener('addAnchorUser', async (inMessage)=>{
      const sch = this.childMap._global.childMap.worldChangeHandler;
      if (sch) {await sch.doBroadcastAction({'status':'addAnchorUser'}, {}, this)}
    });
    this.server.addListener('removeAnchorUser', async (inMessage)=>{
      if (inMessage.anchorId == this.activeEnv.id) {
        await this.activeEnv.notifyListeners(bc.REMOVE_USER_EVENT, {removeUserId:inMessage.userId});
      }
      const sch = this.childMap._global.childMap.worldChangeHandler;
      if (sch) {await sch.doBroadcastAction({'status':'removeAnchorUser'}, {}, this)}
    });
    const env = this.childMap._global;
    await env.notifyListeners(bc.ENVIRONMENT_COMPLETE_EVENT, env);

    clearTimeout(timeOut);
    if (this.design.deploy) {await this.doDeployUtility(null, null)}
    else if (this.design.helpUtil) {await this.doHelpUtility(null, null)}
    else {
      let sceneName = inDesign.sceneName;
      let newEnv = await this.loadEnvironment(inDesign.sceneName, this.world.instanceId);
      await this.switchEnvironment(newEnv);
    }
  }
  doHelpUtilityIndent(indent) {
    let b = [];
    for (let i = 0; i < indent; i++) b.push('  ');
    return b.join('');
  }
  doHelpUtility(inDesign, inDetail) {
    return new Promise((resolve, reject)=>{
      let xmlRequest = new XMLHttpRequest();
      xmlRequest.open('GET', 'assets/help/helpHead.html');
      xmlRequest.responseType = 'text';
      xmlRequest.onload = ()=>{
        if(xmlRequest.response == '') {console.error('Can not load helpHead.html')}
        else {
          let keys = Object.keys(bc.factories);
          keys.sort((a, b)=>{
            let dA = bc.ControlFactory.factoryOf(a);
            let dB = bc.ControlFactory.factoryOf(b);
            let sA = (dA.parentClass.definition ? dA.parentClass.definition.name : 'AAAA') + '_' + dA.fullDefinition.name;
            let sB = (dB.parentClass.definition ? dB.parentClass.definition.name : 'AAAA') + '_' + dB.fullDefinition.name;
            if (sA == sB) {return 0} else if (sA > sB) {return 1} else {return -1}
          });

          let indent = 0;
          let b = ['<!DOCTYPE html>\n', xmlRequest.response];
          b.push(this.doHelpUtilityIndent(++indent), '<body>\n');
          b.push(this.doHelpUtilityIndent(++indent), '<div id="sidebar">\n');
          let currentParentName = null;
          for (let fI = 0, fLen = keys.length; fI < fLen; fI++) {
            let factory = bc.ControlFactory.factoryOf(keys[fI]);
            let parentName = factory.parentClass.definition ? factory.parentClass.definition.name : 'Control';
            if (parentName != currentParentName) {
              b.push(this.doHelpUtilityIndent(indent), '<span class="title"><a href="#', parentName, '">', parentName, '</a></span>\n');
              currentParentName = parentName;
            }
            b.push(this.doHelpUtilityIndent(indent+1), '<span class="navClassName"><a href="#', keys[fI], '">', keys[fI], '</a></span>\n');
          }
          b.push(this.doHelpUtilityIndent(--indent), '</div>\n');
          b.push(this.doHelpUtilityIndent(++indent), '<div id="content">\n');
          b.push(this.doHelpUtilityIndent(indent), '<div id="banner"><span>BraincaveXR API Manual</span></div>\n');
          for (let fI = 0, fLen = keys.length; fI < fLen; fI++) {
            let name = keys[fI];
            let factory = bc.ControlFactory.factoryOf(name);
            let parentClass = factory.parentClass;
            let instanceClass = factory.instanceClass;
            let fDef = instanceClass.definition;
            b.push(this.doHelpUtilityIndent(++indent), '<span class="classSection">\n');
            b.push(this.doHelpUtilityIndent(indent+1), '<span id="', name, '" class="className"><h3>', name, '</h3></span>');
            if (parentClass && parentClass.definition) {
              let pName = parentClass.definition.name;
              b.push('<span class="baseClass"><a href="#', pName,'">', pName, '</a><span class="tooltiptext">Parent Class</span></span>\n') }
            b.push(this.doHelpUtilityIndent(indent+1), '<span class="description">', fDef.description, '</span>\n');
            for (let key in fDef.childMap) {
              let cDef = fDef.childMap[key];
              let symbolDot = '';
              if (cDef.mod == bc.TRAIT) symbolDot = '<div class="symbolDot" title="trait">t</div>';
              else if (cDef.mod == bc.ACTION) symbolDot = '<div class="symbolDot" title="action">a</div>';
              b.push(this.doHelpUtilityIndent(indent+1), '<span class="prop1"><h4>', key, '</h4>', symbolDot, '<small><span class="propType"><a href="#', cDef.type, '">',cDef.type,'</a></span>', cDef.description, '</small></span>\n');
            }
            b.push(this.doHelpUtilityIndent(--indent), '</span>\n');
          }
          b.push(this.doHelpUtilityIndent(--indent), '</div>\n');
          b.push(this.doHelpUtilityIndent(--indent), '</body>\n');
          b.push('</html>\n');
          let helpString = b.join('');
          console.log(b.join(''));
          this.server.serverRequest({type:'updateHelp', message:{fileName:'help.html', anchorDocument:helpString}}).then(()=>{resolve()})
        }
      }
      xmlRequest.send();
    })
  }
  // Parse indexDeploy and send each environment to the Static directory.
  doDeployUtility(inDesign, inDetail) {
    return new Promise((resolve, reject)=>{
      let search = 'design =';
      let xmlRequest = new XMLHttpRequest();
      xmlRequest.open('GET', './indexDeploy.html');
      xmlRequest.responseType = 'text';
      xmlRequest.onload = ()=>{
        if(xmlRequest.response == '') {console.error('Not indexDeploy??')}
        else {
          let buffer = xmlRequest.response;
          let pI = buffer.indexOf(search)+search.length;
          console.log('starting at:', buffer.substr(pI, 100));
          let count = 0;
          let p = {i:pI, d:1, dMax:1000, onObject:(p)=>{
            if (p.d == 2 && ++count <= 2000) {
              let parts = p.pKey.split('=>');
              console.log('output environment:', parts[0], ' depth:', p.d, ' start:', p.iStart, ' end:', p.i);
//              console.log(buffer.substr(p.iStart, p.i-p.iStart))
              let sceneId = parts[0];
              this.server.serverRequest({type:'updateStatic', message:{sceneId:sceneId, anchorDocument:buffer.substr(p.iStart, p.i-p.iStart)}});
            }
          }};
          this.skipFill(buffer, p);
          let o = this.toJSONFromString(buffer, p);
          resolve()}
      };
      xmlRequest.send();
    })
  }

  async loadEnvironment(inDesignId, inInstanceId) {
    let detail = this.detail;
    let newEnvId = inDesignId+'-'+inInstanceId;
    let newEnvDesign = null;
    let message = {userId:this.agent.userId, anchorId:newEnvId};
    let isNew = true;

    // If design is local then use it otherwise load from server.
    let fullId = '_world.'+newEnvId;

console.warn('fullId:', fullId);
    this.addStatus(1); // Needed to start the load status.
    if (this.design[inDesignId]) {newEnvDesign = this.factory.copyDesign(this.design[inDesignId])}

    // Get the base anchor users and document.
    let anchorResponse = await this.server.serverRequest({type:'resourceAnchorRequest', message:message});

    let userKeys = anchorResponse.userKeys;

    // If there are other active users then get the updated document from them.
    // In the future this should only contain the differences in the document from the base.
    if (userKeys.length > 0) {
      // Grab the current state from the top user attached to the anchor
      let userKey = userKeys[0];
      const response = await this.server.directRequest(userKey, 'environment', {anchorId:newEnvId});
      newEnvDesign = this.toDesignFromString(response.anchorDocument);
console.log('newEnvDesign:', newEnvDesign);
      isNew = false;
    } else if (!newEnvDesign || this.persist) {
      newEnvDesign = this.toDesignFromString(anchorResponse.anchorDocument);
console.log('newEnvDesign:', newEnvDesign);
    }
    newEnvDesign.type = 'Environment';
    let envFactory = bc.ControlFactory.factoryOf(newEnvDesign.type);
    envFactory.modifyDesign(newEnvDesign, {id:newEnvId, instanceId:inInstanceId, designId:inDesignId});
    if (this.world.activeEnv) {
      this.world.previousEnvironmentName = this.world.activeEnv.id.split('-')[0];
    }
    let hack = {childMap:{}};
    hack.childMap[newEnvId] = newEnvDesign;
    let timeOut = setTimeout(()=>{
      console.log('world:', bc.world);
      console.log('status:', this.statusMap);
      console.error('Design TimeOut design:', hack); console.trace(); debugger;
    }, debugDelay+1);

    const envDesign = {};

    // Hack - instead of executeBuild we manage the creation of the enviornment ourselves because we
    // need the environment created to act as the handler for execution.
    envDesign[newEnvId] = {id:newEnvId, isNew:isNew, type:'Environment'};
    await this.executeDesign(envDesign);
    delete newEnvDesign.type;
    delete newEnvDesign.id;
    await this.childMap[newEnvId].executeDesignHack(newEnvDesign);
    if (newEnvDesign.onInitialized) await this.childMap[newEnvId].executeRules(newEnvDesign.onInitialized);

    this.removeStatus(1);
    clearTimeout(timeOut);
    const env = this.childMap[newEnvId];
    env.userKeys = anchorResponse.userKeys;
    env.isNew = false;
    return env;
  }
  async switchEnvironment(newEnv) {
    // null current focus before switching environments;
    let oldEnv = this.activeEnv;
    let controllerMap = this.agent.controllerMap;
    if (oldEnv) {
      let oldEnvDesign = this.toStringFromDetail(oldEnv, bc.PART_DESIGN);
      let message = {userId:this.identity.id, anchorId:oldEnv.id, anchorDocument:oldEnvDesign};
      for (let cKey in controllerMap) {controllerMap[cKey].isActive = false; controllerMap[cKey].control = null; controllerMap[cKey].lastControl = null}
      let controllersBusy = true;
      oldEnv.shutdown = true;
      let process = oldEnv.newProcess({name:'Switch Environment'});
      // Wait until all processes are finished except for Switch Environment process.
      while (controllersBusy || oldEnv.processCount > 1) {
        await process.tickWait();
        controllersBusy = false;
        for (let cKey in controllerMap) {
          if (controllerMap[cKey].isBusy) {
            controllersBusy = true;
            break;
          }
        }
      }
      oldEnv.removeProcess(process);
      let response = await this.server.serverRequest({type:'resourceUnanchorRequest', message:message});
      // We have to wait for all input transactions to finish before disconnecting so
      // that the old design is correctly sent to save on the server when we go through
      // a portal.
      this.renderer.setAnimationLoop(null);
    }
    this.activeEnv = newEnv;
    this.renderer.setAnimationLoop(this.render);
    this.world.scene.add(newEnv.object3D);

    await newEnv.notifyListeners(bc.ENVIRONMENT_COMPLETE_EVENT, newEnv);

    // Notify script of controllers.
    for (let key in controllerMap) {
      let controller = controllerMap[key];
      await newEnv.notifyListeners(bc.ADD_CONTROLLER_EVENT, {name:controller.profile.name});
    }

    // Notify script of current users.
    newEnv.userCount = 1;
    for (let uI = 0; uI < newEnv.userKeys.length; uI++) {
      let userKey = newEnv.userKeys[uI];
      await newEnv.notifyListeners(bc.ADD_USER_EVENT, {newUserId:userKey});
    }
    await this.agent.initializeEnvironment(newEnv);
    for (let cKey in controllerMap) {controllerMap[cKey].isActive = true}
    if (oldEnv) oldEnv.remove();
  }
  get sceneName() {
    return this.activeEnv.id;
  }
  // Builds a list of controls that are new targets based on the
  // looking at the old targets and the new control and it's parents.
  addTargets(placeHolder, target) {
    let oldTargets = this.agent.targets;
    let newTargets = [];
    let diffTargets = [];
    while (target && target.object3D && target.object3D.bcc) {
      if (target.object3D.bcc) newTargets.push(target);
      target = target.parent;
    }
    let diffI = 0;
    while(diffI < oldTargets.length && diffI < newTargets.length && oldTargets[diffI] == newTargets[diffI]) diffI++;
    for (let i = diffI; i < newTargets.length; i++) diffTargets.push(newTargets[i]);
    this.agent.targets = newTargets;
    return diffTargets;
  }
  render() {
    let world = bc.world;
    let start = Date.now();
    world.activeEnv.animate();
    let end = Date.now();
    if (end - start > 10) console.log('time:', end - start);
    world.renderer.render(world.scene, world.agent.camera);
    if (!world.agent.arToolkitContext || !world.agent.arToolkitSource || !world.agent.arToolkitSource.ready) {}
    else {
      world.agent.arToolkitContext.update(world.agent.arToolkitSource.domElement)
      // update scene.visible if the marker is seen
      world.agent.activeAR = world.agent.camera.visible;
      if (world.agent.onAREvent) {
        world.agent.executeRules(world.agent.onAREvent);
        world.agent.camera.visible = true;
      } else {
        world.scene.visible = world.agent.camera.visible;
      }
    }
  }
  addLinefeed(indent) {
    let out = [];
    out.push('\n');
    for (var i = 0; i < indent; i++) out.push('  ');
    return out.join('');
  }
  toFormattedString(inString) {
    let out = [];
    out.push("'");
    if (inString == null) return null;
    for (let cI = 0, cLen = inString.length; cI < cLen; cI++) {
      if (inString[cI] == "'" || inString[cI] == '\\') {out.push('\\'+inString[cI])}
      else if (inString[cI] == '\n') out.push('\\'+'n');
      else out.push(inString[cI]);
    }
    out.push("'");
    return out.join('');
  }
  toStringFromIndent(indent) {
    let out = [];
    for (let i = 0; i < indent; i++) out.push('  ');
    return out.join('');
  }
  toStringFromKey(inKey) {
    let cI = 0;
    for (let cLen = inKey.length; cI < cLen; cI++) {
      let c = inKey[cI];
      if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z') {}
      else if (cI > 0 && c >= '0' && c <= '9') {}
      else break;
    }
    if (cI == inKey.length) return inKey;
    else return "'"+inKey+"'";
  }
  toFormat(inFormat, value) {
    inFormat.b.push(value);
    inFormat.bL += value.length;
  }
  toStringFromLF() {return '\n'}
  // Format the design into a nice looking string script.
  toStringFromDesignRecurse(inFormat, inDesign, inKey, inFactory, indent) {
    let keys = null;
    let fullKey = null;
    let path = null;
    let factory = inFactory;
    // Build a full key path by colapsing objects with only one key in them and combining keyNames.
    if (inKey != null) {
      path = [inKey];
      while (typeof inDesign == 'object' && !Array.isArray(inDesign) && (keys = Object.keys(inDesign)).length == 1) {
        let cDef = factory.fullDefinition.childMap[keys[0]];
        cDef = cDef ? cDef : {type:bc.CONTROL};
        factory = bc.ControlFactory.factoryOf(cDef.type);
        inDesign = inDesign[keys[0]];
        path.push(keys[0]);
      }
      fullKey = path.join('.');
    }
    if (inDesign.type) {this.toFormat(inFormat, this.toStringFromLF() + this.toStringFromIndent(indent))};

    if (inDesign == null) {}
    else if (Array.isArray(inDesign)) {
      // If Array is rules then set an indent.
      let hasIndent = inDesign.length > 0 ? (typeof inDesign[0] == 'object' ? 1 : 0) : 0;
      if (hasIndent) {this.toFormat(inFormat, this.toStringFromLF() + this.toStringFromIndent(indent)); indent++}
      if (fullKey != null) {this.toFormat(inFormat, this.toStringFromKey(fullKey)+':')}
      let isStringFormula = true;
      for (let cI = 0, cLen = inDesign.length; cI < cLen && isStringFormula; cI++) {if (typeof inDesign[cI] == 'object') isStringFormula = false}
      let d = '';
      if (isStringFormula) {
        this.toFormat(inFormat, "['");
        d += "['";
          for (let cI = 0, cLen = inDesign.length; cI < cLen; cI++) {
            if (cI > 0) {this.toFormat(inFormat, ' ')}
            this.toFormat(inFormat, inDesign[cI]);
            if (cI > 0) {d += " "}
            d += inDesign[cI];
          }
        this.toFormat(inFormat, "']");
        d += "']";
      } else {
        this.toFormat(inFormat, "[");
          for (let cI = 0, cLen = inDesign.length; cI < cLen; cI++) {
            let key = cI;
            if (cI > 0) {this.toFormat(inFormat, ', ')}
            if (hasIndent) {this.toFormat(inFormat, this.toStringFromLF() + this.toStringFromIndent(indent))};
            this.toStringFromDesignRecurse(inFormat, inDesign[key], null, factory, indent+hasIndent);
          }
        this.toFormat(inFormat, ']');
      }
    }
    else if (typeof inDesign == 'object') {
      let hasIndent = 0;
      let isCreation = false;
      if (fullKey != null) {
        const splitIt = fullKey.split('.');
        if (inDesign.type && inDesign.id) {isCreation = true; this.toFormat(inFormat, this.toStringFromKey(fullKey+'=>'+inDesign.type)+':')}
        else {this.toFormat(inFormat, this.toStringFromKey(fullKey)+':') } }
      if (inDesign.type == 'Remove') {this.toFormat(inFormat, '{}')} // Hack - Remove needs to change to doRemove.
      else {
        factory = inDesign.type ? bc.ControlFactory.factoryOf(inDesign.type) : factory;
        if (inDesign._value) {
          if (hasIndent) this.toFormat(inFormat, this.toStringFromIndent(indent));
          this.toStringFromDesignRecurse(inFormat, inDesign._value, null, factory, indent+hasIndent);
        } else {
          this.toFormat(inFormat, '{')

          let out = [];
          let properties = [];
          if (factory instanceof bc.PrimeRULESFactory) factory = bc.ControlFactory.factoryOf(bc.CONTROL);
          if (!factory) {console.error('no factory for ', inDesign)}
          for (let key in inDesign) {
            // ignore id and type if they were used in the id=>type shorthand.
            if (isCreation && (key == 'id' || key == 'type')) {}
            else {
              let cDef = factory.fullDefinition.childMap[key];
              cDef = cDef ? cDef : {order:1000, type:bc.CONTROL};
              let cOrder = cDef.order ? cDef.order : 0;
              let cFactory = bc.ControlFactory.factoryOf(cDef.type);
              properties.push([key, cFactory, cOrder]);
            }
          }
          if (fullKey != 'childMap') {
            properties.sort((a,b)=>{
              let aO = a[2];
              let bO = b[2];
              if (aO < bO) return -1;
              else if (aO > bO) return 1;
              else {
                if (a[0] < b[0]) return -1;
                else if (a[0] > b[0]) return 1;
                else return 0;
              }
            });
          }
          let saveLen = inFormat.bL;
          for (let cI = 0, cLen = properties.length; cI < cLen; cI++) {
            let key = properties[cI][0];
            if (cI > 0) {this.toFormat(inFormat, ', ')}
            let cFactory = properties[cI][1];
            hasIndent = inDesign.type ? 1 : 0;
            this.toStringFromDesignRecurse(inFormat, inDesign[key], key, cFactory, indent+hasIndent);
          }
          this.toFormat(inFormat, '}');
        }
      }
    }
    else if (typeof inDesign == 'string') {
      if (fullKey != null) {this.toFormat(inFormat, this.toStringFromKey(fullKey)+':')}
      this.toFormat(inFormat, this.toFormattedString(inDesign))}
    else {
      if (fullKey == 'color') {this.toFormat(inFormat, this.toStringFromKey(fullKey)+':0x'+inDesign.toString(16))}
      else if (fullKey == 'emissive') {this.toFormat(inFormat, this.toStringFromKey(fullKey)+':0x'+inDesign.toString(16))}
      else if (fullKey != null) {this.toFormat(inFormat, this.toStringFromKey(fullKey)+':'+inDesign.toString())}
      else {this.toFormat(inFormat, inDesign.toString())}
    }
  }
  toStringFromDesign(design) {
    let b = [];
    let orderMap = {id:-100, type:-99, url:-98, onInitialized:-1, onFocused:2, onUnfocused:3, onSelected:4, onUnselected:5, onActivated:6, onUnactivated:7, childMap:100}
    let format = {orderMap:orderMap, b:[], bL:0};
    let factory = bc.ControlFactory.factoryOf(design.type);
    this.toStringFromDesignRecurse(format, design, null, factory, 1);
    let out = format.b.join('');
//    console.log('out:', out);
    return out;
  }

  toStringFromDetail(control, inMode) {
    let design = control.factory.toDesignFromDetail(control, inMode, null);
    let out = this.toStringFromDesign(design);
    return out;
  }
  static newWorld(design, sceneName, callback) {
    // Hack - change World to be created by ControlFactory class
    let world = bc.world = new bc.control.World(null, design, sceneName, callback);
    world.factory = bc.ControlFactory.factoryOf('World');
    return world;
  }
  toJSONFromString(c, p) {
    let iStart = p.i;
    let pKey = p.key;
    let o = {};
    p.d++;
    while (c[p.i] != '}') {
      p.i++;
      this.skipFill(c, p);
      if (c[p.i] == '}') break; // Extra comma
      let key = this.parseKey(c, p);
      this.skipFill(c, p);
      p.i++; // skip :
      this.skipFill(c, p);
      p.key = key;
      let value = this.parseValue(c, p);
      this.skipFill(c, p);
      o[key] = value;
      if (++this.debug > 100080) return;
    }
    p.i++; // Skip }
    this.skipFill(c,p);
    p.d--;
    p.iStart = iStart;
    p.pKey = pKey;
    if (p.onObject) p.onObject(p);
    return o;
  }
  parseArray(c, p) {
    let o = [];
    p.d++;
    while (c[p.i] != ']') {
      p.i++;
      this.skipFill(c, p);
      if (c[p.i] == ']') break; // Extra comma
      let value = this.parseValue(c, p);
      this.skipFill(c, p);
      o.push(value);
      if (++this.debug > 100080) return;
    }
    p.i++; // Skip }
    p.d--;
    return o;
  }
  parseValue(c, p) {
    let value = null;
    if (c[p.i] == '{') {
      value = this.toJSONFromString(c, p);
    } else if (c[p.i] == '[') {
      value = this.parseArray(c, p);
    } else {
      let b = [];
      if (c[p.i] == "'") {
        p.i++;
        while (true) {
          if (c[p.i] == '\\') {
            p.i++;
            if (c[p.i] == 'n') b.push('\n');
            else b.push(c[p.i]);
            p.i++;
          }
          else if (c[p.i] == "'") {p.i++; break;}
          else {
            b.push(c[p.i]);
            p.i++;
          }
        }
        value = b.join('')
      }
      else if (c[p.i] == '"') {p.i++; while (c[p.i] != '"') b.push(c[p.i++]); p.i++; value = b.join('')}
      else {
        while (c[p.i] != '}' && c[p.i] != ']' && c[p.i] != ' ' && c[p.i] != '\n' && c[p.i] != ',') b.push(c[p.i++]);
        let test = b.join('');
        if (test == 'false') value = false;
        else if (test == 'true') value = true;
        else if (isNaN(test)) {value = test}
        else value = Number(test);
      }
    }
    return value;
  }
  parseKey(c, p) {
    let b = [];
    if (c[p.i] == "'") {p.i++; while (c[p.i] != "'") b.push(c[p.i++]); p.i++}
    else if (c[p.i] == '"') {p.i++; while (c[p.i] != '"') b.push(c[p.i++]); p.i++}
    else {while (c[p.i] != ':' && c[p.i] != ' ') {b.push(c[p.i++])}}
    return b.join('');
  }
  skipFill(c, p) {
    while (c[p.i] == ' ' || c.charCodeAt(p.i) == 9 || c.charCodeAt(p.i) == 10 || c.charCodeAt(p.i) == 13) {p.i++}
    if (c[p.i] == '/') {
      if (c[p.i+1] == '*') {
        p.i += 2;
        while (c[p.i] != '*' || c[p.i+1] != '/') {p.i++}
        p.i += 2;
        this.skipFill(c, p) }
      else if (c[p.i+1] == '/'){
        p.i += 2;
        while (c.charCodeAt(p.i) != 13 && c.charCodeAt(p.i) != 10) {p.i++}
        this.skipFill(c, p) } }
  }
  compileString(body) {
    let e = body;
    let i = 0;
    let opCheck = this.world.ops;
    let out = [];
    let opsCount = 0;
    let negativeCheck = true;
    while (i < e.length) {
      if (e[i] == ' ') {i++}
      else if (e[i] == '(') {
        let b = [];
        let count = 1;
        i++; // Skip (
        while (count > 0 && i < e.length) {
          if (e[i] == ')') {if (--count) {b.push(e[i++])}}
          else if (e[i] == '(') {count++; b.push(e[i++])}
          else {b.push(e[i++])}
        }
        if (count != 0) console.error('Incorrect parenthesis in formula:', body);
        i++; // Skip )
        let value = this.compileString(b.join(''));
        out.push(value);
        negativeCheck = false;
      }
      else if (opCheck[e.charCodeAt(i)]) {
        // Hack - anoter hack to deal with negative.
        if (negativeCheck && e[i] == '-') {
          let b = ['-'];
          i++;
          while (!opCheck[e.charCodeAt(i)] && e[i] != ' ' && i < e.length) {b.push(e[i++])}
          let value = b.join('');
          // If value is only - with no number then just push the -
          if (value == '-') out.push(value);
          else out.push(Number(value));
          negativeCheck = false;
        } else {
          let operator = e[i++];
          while (i < e.length && opCheck[e.charCodeAt(i)]) {operator += e[i++]}
          out.push(operator);
          opsCount++
          negativeCheck = true;
        }
      }
      else {
        let b = [];
        while (!opCheck[e.charCodeAt(i)] && e[i] != ' ' && i < e.length) {
          if (e[i] == '"') {
            while (e[++i] != '"') b.push(e[i]);
            i++;
          } else b.push(e[i++])
        }
        let value = b.join('');
        if (isNaN(value)) {
//          if (value[0] == '.') {if (value == '.') value = 'current'; else value='current'+value}
          if (value[0] == '#') value = {'string':value.substr(1)};
          if (value == 'false') {value = false}
          else if (value == 'true') {value = true}
          else if (value == 'Math.PI') {value = Math.PI}
        } else {
          if (out.length-opsCount < 0) {console.log('negative?', ops, out); ops.pop();value = -Number(value)}
          else {value = Number(value)}
        }
        out.push(value);
        negativeCheck = false;
      }
    }
    return out;
  }

  toDesignFromJSON(inJSON, inPath) {
    // Compile the JSON into a more efficient design structure
    // convert paths <property>.<property>... into hierarchical structures
    // if . in front of path then append current property
    // if => found then its a constructor so set type property and id.
    let keys = Object.keys(inJSON);
    for (let kI = 0; kI < keys.length; kI++) {
      let key = keys[kI];
      let child = inJSON[key];

      // First resolve type if it is in <key>=><type> form
      let path = null;
      let parts = key.split('=>');
      if (parts.length == 2) {
        if (Array.isArray(child) || typeof child != 'object') child = {_value:child};
        child.type = parts[1];
        path = parts[0].split('.');
        child.id = path[path.length-1];
        if (child.type == "") {
          console.error('key:', key, ' parts:', parts, ' inJSON:', inJSON, ' No Type at:', inPath.join('.')+'.'+key)
          debugger;
        }
        delete inJSON[key];
      } else {
        path = key.split('.');
      }
//      if (path[0] == '') {path[0] = 'current'}

      // Expand an object hierarchy when the key has a path in it which are keys seperated by dots.
      let newKey = path[0];
      if (path.length > 1) {
        let current = inJSON;
        let pI = 0;
        while (pI < path.length-1) {
          let pathKey = path[pI++];
          if (current[pathKey] == null) current[pathKey] = {};
          current = current[pathKey];
        }
        current[path[path.length-1]] = child;
        child = inJSON[newKey];
        delete inJSON[key];
      }

      // Tokenize strings inside of arrays if they are formulas. This makes it easier and faster at runtime.
      if (Array.isArray(child) && newKey != 'data' && inJSON.type != 'JSONSource' && newKey != 'urls') {
        let newArray = [];
        for (let aI = 0; aI < child.length; aI++) {
          let part = child[aI];
          if (typeof part == 'string') {
            let out = this.compileString(part);
            newArray = newArray.concat(out);
          } else newArray.push(part);
        }
        child = newArray;
      }
      inJSON[newKey] = child;
      inPath.push(newKey);
      if (typeof child == 'object') this.toDesignFromJSON(child, inPath);
      inPath.pop();
    }
    return inJSON;
  }

  toDesignFromString(c) {
    this.debug = 0;
    let p = {i:0, d:0, dMax:1000};
    this.skipFill(c, p);
    let o = this.toJSONFromString(c, p);
    return this.toDesignFromJSON(o, []);
  }
  doLogAction(inDesign, inDetail, inHandler) {
    if (inDetail == 'debugger') {
      debugger;
    }
    console.log('log(', inHandler.localId, '): ', inDetail)
  }
  async doLog2Action(inDesign, inDetail, inHandler) {
    let path = inDetail.split('.');
    let result = await inHandler.factory.toValueFromPath(inHandler, path, null, null);

    console.log('log(', inHandler.localId, '): ', result);
  }
  static newType(inType, inDesign) {
    let factory = bc.ControlFactory.factoryOf(inType);
    return factory.build(inDesign);
  }
  async doSwitchWorldAction(inDesign, inWorldId) {
    if (this.worldId) {
      let response = await this.server.serverRequest({type:'leaveAnchorRequest', message:{anchorId:this.worldId}});
      console.log('doSwitchWorldAction - after leaveAnchorRequest response:', response);
    }
    // instanceId is same as world id and need to be the same some day.
    this.worldId = this.instanceId = inWorldId;
    let response = await this.server.serverRequest({type:'joinAnchorRequest', message:{anchorId:this.worldId}});
  }
  async doWorldStatusAction(inDesign, inSource) {
    const grid = inSource.grid;
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {
      const record = grid[rI];
      const worldId = record.map['NAME'];
      let response = await this.server.serverRequest({type:'statusAnchorRequest', message:{anchorId:worldId}});
      record.map['USERS'] = response.userCount;
    }
  }
  static get definition() {return {name:'World', type:bc.CLASS, childMap:{
    agent:{type:bc.CONTROL, mod:bc.TRAIT, description:'Agent Identity'},
    randomUUID:{type:bc.STRING, mod:bc.TRAIT, description:'Returns a unique UUI everytime it is accessed'},
    doLog:{type:bc.STRING, mod:bc.ACTION, description:'Just like a println in a normal language'},
    doLog2:{type:bc.DATA, mod:bc.ACTION, description:'Used to dump detail on an object'},
    doWorldStatus:{type:'Source', mod:bc.ACTION, description:'update a table of worlds with number of users'},
    doSwitchWorld:{type:bc.STRING, mod:bc.ACTION, description:'Switch to a new worldId'},
    deploy:{type:bc.BOOLEAN, mod:bc.ACTION, description:'Used by system writers to rewrite base environment scripts that are stored in Static directory'},
    persist:{type:bc.BOOLEAN, mod:bc.FIELD, description:'Environments will be loaded from a persisted state if found.'},
    timeout:{type:bc.INTEGER, mod:bc.FIELD, order:12, description:'The time used to display possible errors in execution.  Must be high enough to let the scene load'},
    previousEnvironmentName:{type:bc.STRING, mod:bc.FIELD, order:10, description:'Previous environment name.  Can be changed if needed'},
    instanceUUID:{type:bc.STRING, mod:bc.FIELD, order:11, description:'The current unique world instance'}}}}
}
bc.ControlFactory.newFactory(bc.control.World);
bc.World = bc.control.World;
bc.Process = class {
  constructor(inDetail) {this.id = bc.world.uuid++; this.detail = inDetail}
  async tickWait() {
    return new Promise((resolve, reject)=>{
      this.onCallback = (inNow)=>{this.onCallback = null; resolve(inNow);}
    })
  }
  async stop() {
    return new Promise((resolve, reject)=>{
      this.onStop = (inNow)=>{this.onStop = null; resolve(inNow)};
    })
  }
}
bc.control.Environment = class extends bc.control.Control3D {
  designQueue = [];
  intersectable3D = [];
  instanceId = '';
  isActive = true;
  trash = {};
  processCount = 0;
  processMap = {};
  userMap = {};
  userCount = 0;
  isNew = false;
  controllerAvatarMap = {};
  get env() {return this}
  get area() {return this}
  get concept() {return this}
  get localId() {return 'env'}
  get processor() {return this};
  buildUrl(url) {return '/'+url}
  newProcess(inDetail) {
    let process = new bc.Process(inDetail);
    this.processMap[process.id] = process;
    this.processCount++;
    if (inDetail && inDetail.size) {bc.world.addStatus(inDetail.size)}
    return process;
  }
  removeProcess(process) {
    process.stop();
    if (process.detail && process.detail.size) {bc.world.removeStatus(process.detail.size)}
    if (process.onComplete) {process.onComplete()}
    delete this.processMap[process.id];
    this.processCount--;
  }
  async removeControl(inDesign, inDetail) {
    const controlRef = await this.factory.toValueFromPath(this, inDetail.split('.'));
    const control = controlRef[4];
    const design = {childMap:{}};
    design.childMap[control.id] = {type:'Remove'};
    await control.parent.executeDesign(design);
  }
  addIntersectable(control) {
    let new3D = control.object3D;
    var intersectable3D = this.intersectable3D;
    for(let i = 0, length = intersectable3D.length; i < length; i++)
      {if (new3D === intersectable3D[i]) return}
    this.intersectable3D.push(new3D);
    new3D.bcc = control;
  }
  removeIntersectable(control){
    let remove3D = control.object3D;
    var intersectable3D = this.intersectable3D;
    for(let i = 0; i < intersectable3D.length; i++){
      let found3D = intersectable3D[i];
      if(remove3D === found3D){
        remove3D.bcc = null;
        intersectable3D.splice(i--, 1);
        break;
      }
    }
  }
  animate() {
    let now = Date.now();
    let activeEnv = this.world.activeEnv;
    if (activeEnv.shutdown) now = bc.FINISH;
    for (let key in activeEnv.processMap) {
      let process = activeEnv.processMap[key];
      if (process.onStop) {process.onCallback(bc.FINISH); process.onStop(bc.FINISH)}
      if (process.onCallback) {process.onCallback(now)}
    }
    return activeEnv.processCount;
  }
  userBroadcast(inType, inAnchorId, inMessage) {
    if (this.userCount > 1) {this.server.broadcast(inType, inAnchorId, inMessage)}
  }
  get doIterateControllers() {return bc.ControlFactory.newInstance('DoIterate', this, {id:name, type:'DoIterate'})}
  // Iterate an array by bui1lding a loop control to handle te looping.  Remove it after execution.
  async doIterateControllersAction(inDesign, inDetail, inHandler) {
    inDetail.parent = inHandler;
    for (let key in this.controllerAvatarMap) {
      inDetail.current = this.controllerAvatarMap[key];
      await inDetail.executeRules(inDetail.onNext);
    }
    inDetail.parent = null;
  }
  remove() {
    super.remove();
    this.intersectable3D = null;
    this.timeListeners = null;
  }
  static get definition() {return {name:'Environment', type:bc.CLASS, childMap:{
    isNew:{type:bc.BOOLEAN, mod:bc.FIELD, description:'True if this environment is not from a persisted state.'},
    instanceId:{type:bc.STRING, mod:bc.FIELD, order:0, description:'DEPRECATED - Worlds Instance Id'},
    designId:{type:bc.STRING, mod:bc.FIELD, order:1, description:'DEPRECATED - duplicate of id'},
    defaultTexture:{type:bc.STRING, mod:bc.FIELD, order:3, description:'Used by SmartTexture to define a default texture extension'},
    doIterateControllers:{type:'DoIterate', mod:bc.ACTION, description:'Iterate over self controllers built using Controller3D'},
    removeControl:{type:bc.STRING, mod:bc.ACTION}}
  }}
}
bc.ControlFactory.newFactory(bc.control.Environment);
bc.control.Uniforms = class extends bc.control.Control {
  static get definition() {return {name:'Uniforms', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.Uniforms);
bc.control.ShaderMaterial = class extends bc.control.Control {
  side = 2;
  init(inDesign) {
    this._uniforms = {};
    for (let key in this.uniforms.childMap) {
      let child = this.uniforms.childMap[key];
      if (key == 'color') {this._uniforms[key] = {type:'color', is:'uniform'}}
      else if (child instanceof bc.control.Float) {this._uniforms[key] = {type:'float', value:0.0}}
      else if (child instanceof bc.control.Texture || child instanceof bc.control.Pointer) {this._uniforms[key] = {type:'texture'}}
    }
    this.doUpdateAction();
    this.value = new THREE.ShaderMaterial({
      side : this.side,
      uniforms: this._uniforms,
      fragmentShader: this.fragmentShader.ref.value,
      vertexShader: this.vertexShader.ref.value
    });
  }
  doUpdateAction() {
    for (let key in this.uniforms.childMap) {
      let child = this.uniforms.childMap[key];
      if (key == 'color') {this._uniforms[key].value = new THREE.Color(child.ref.value).convertSRGBToLinear()}
      else if (child instanceof bc.control.Float) {this._uniforms[key].value = child.ref.value}
      else if (child instanceof bc.control.Texture || child instanceof bc.control.Pointer) {this._uniforms[key].value = child.ref.value}
    }
  }
  static get definition() {return {name:'ShaderMaterial', type:bc.CLASS, childMap:{
    side:{type:bc.INTEGER, mod:bc.FIELD, default:2, description:'Side'},
    uniforms:{type:'Uniforms', mod:bc.FIELD, description:'Uniforms control object'},
    doUpdate:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Update shader with new uniforms'},
    fragmentShader:{type:'String', mod:bc.FIELD, description:'fragment shader string'},
    vertexShader:{type:'String', mod:bc.FIELD, description:'vertex shader string'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.ShaderMaterial);
bc.control.User = class extends bc.control.Control3D {
  controllerMap = {};
  init(inDesign) {this.env.userMap[this.id] = this; this.env.userCount++}
  static get definition() {return {name:'User', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.User);
bc.control.Controller3D = class extends bc.control.Control3D {
  init(inDesign) {
    const controllerAvatarMap = this.env.controllerAvatarMap;
    this.env.controllerAvatarMap[this.attach] = this;
  }
  static get definition() {return {name:'Controller3D', type:bc.CLASS, childMap:{
    attach:{type:bc.STRING, mod:bc.FIELD, description:'Name of system controller to attach to this 3D controller'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Controller3D);
bc.control.Controller3DMimic = class extends bc.control.Control3D {
  init(inDesign) {
//    console.log('Controller3DMimic - init design:', inDesign, ' this:', this);
    this.env.userMap[this.userId].controllerMap[this.controllerId] = this;
  }
  remove() {
    this.env.userMap[this.userId].controllerMap[this.controllerId] = null;
    super.remove();
  }
  static get definition() {return {name:'Controller3DMimic', type:bc.CLASS, childMap:{
    controllerId:{type:bc.STRING, mod:bc.FIELD, description:'controller id to mimic'},
    userId:{type:bc.STRING, mod:bc.FIELD, description:'user id of controller id'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Controller3DMimic);

bc.Controller = class {
  listenerUID = 0;
  listenerMap = {};
  storePosition = new THREE.Vector3();
  storeRotation = new THREE.Vector3();
  isActive = true;
  ignore = false;
  buttonStateMap = {Grab:{pressed:false}, Select:{pressed:false}, ButtonA:{pressed:false}, ButtonB:{pressed:false}};
  isBusy = false;
  async updateState() {
    if (!this.isBusy) {
      if (this.isActive) {
        this.isBusy = true;
        this.getIntersection();
        // Notify previous control so that the unfocus is triggered if the intersect moves form the current control.
        // If parents are null then the object was deleted so reset controller.
        if (this.lastControl && this.lastControl != this.control) {
          if (!this.lastControl.parent) {
            this.lastControl = null; this.isLocked = false}
          else {
            await this.lastControl.notifyListeners(bc.INTERSECT_EVENT, {controller:this, state:'unfocus'})
          }
        }
        if (this.control) {
          if (!this.control.parent) {
            console.log('WUT??');
            this.control = null; this.isLocked = false}
          else await this.control.notifyListeners(bc.INTERSECT_EVENT, {controller:this, state:'focus'});
        }
        this.isBusy = false;
      }
    }
  }
}
bc.HandController = class extends bc.Controller {
  raycaster = new THREE.Raycaster();
  tempMatrix = new THREE.Matrix4();
  constructor(inputSource, profile, object3D) {
    super()
    this.inputSource = inputSource;
    this.profile = profile;
    this.object3D = object3D;
  }
  getIntersection() {
    let env = bc.world.activeEnv;
    this.tempMatrix.identity().extractRotation(this.object3D.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(this.object3D.matrixWorld);
    this.raycaster.ray.direction.set( 0, 0, -1).applyMatrix4(this.tempMatrix);
    this.storeRotation.copy(this.object3D.rotation.reorder('YXZ'));
    this.storePosition.setFromMatrixPosition(this.object3D.matrixWorld);

    let intersections = this.raycaster.intersectObjects(env.intersectable3D, true );
/*    let hr = new THREE.Euler();
    hr.setFromRotationMatrix(this.object3D.matrix);
    this.raycaster.set(this.object3D.position, this.object3D.rotation.toVector3().normalize());
    let intersections = this.raycaster.intersectObjects(env.intersectable3D, true ); */
//console.log('p:', this.object3D.position, ' r:', this.object3D.rotation.toVector3());


    let intersection = null;
    let i = 0;
    let control = null;
    for (let i = 0, len = intersections.length; !intersection && i < len; i++) {
      intersection = intersections[i];
      let target3D = intersection.object;

      // First find a handler in the hierarchy attached to threejs object because
      // a control could have a hierarchy of threejs objects.
      while (target3D && !target3D.bcc) target3D = target3D.parent;
      let target = null;
      if (target3D) target = target3D.bcc;

      // Then check the control hierarchy to find a handler that is active and visible.
      while (target) {
        let target3D = target.object3D;
        if (target3D) {
          if (!target3D.visible) {control = null; break} // Ignore intersection with non visibility
          else if (target.unactive) control = null; // discount unactive controls in hierarchy
          else if (target3D.bcc && !control) control = target; // sect new control if not set yet.
        }
        target = target.parent;
      }
      if (control) {intersection.object = control.object3D}
      else intersection = null;
    }
    if (!this.isLocked) {
      this.lastControl = this.control;
      this.control = control;
    }
    this.intersection = intersection;
  }
  async updateState() {
    let buttonStateMap = this.buttonStateMap;
    let gamepad = this.inputSource.gamepad;
    let buttonMap = this.profile.buttonMap;
    // Hack - This means it's not a device with buttons so we exit
    if (!gamepad) {return}
    let changed = false;
    let buttonData = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let bKey in buttonMap) {
      let index = buttonMap[bKey].index;
      if (index < gamepad.buttons.length) {
        let buttonState = buttonStateMap[bKey];
        let button = gamepad.buttons[index];
        if (button.pressed && !buttonState.pressed) buttonData[index] = 1;
        if (!button.pressed && buttonState.pressed) buttonData[index] = 2;
        if (buttonState.pressed != button.pressed) {changed = true}
        buttonState.pressed = button.pressed;
      }
    }
    let axisX = gamepad.axes[2];
    let axisY = gamepad.axes[3];
    if (changed || axisX < -.1 || axisX > .1 || axisY < -.1 || axisY > .1) {
      await bc.world.activeEnv.notifyListeners(bc.CONTROLLER_EVENT, {selectState:buttonData[0], buttonBState:buttonData[5], buttonAState:buttonData[4], axisX:gamepad.axes[2], axisY:gamepad.axes[3]});
    }
    await super.updateState();
  }
}
bc.KeyboardController = class extends bc.Controller {
  type = 'KeyboardController';
  profile = {
    name:'generic-keyboard',
    handedness:'other',
    buttonMap:{}
  };
  asMimic() {return this}
  asMaster(device) {return this};
  async updateState() {}
}
bc.MouseController = class extends bc.Controller {
  type = 'MouseController';
  lastX = null; lastY = null; sensitivity = .2; mousex = 0; mousey = 0;
  profile = {
    name:'generic-mouse-other',
    handedness:'other',
    buttonMap:{'Grab':{index:1},'Select':{index:0},'ButtonA':{index:4},'ButtonB':{index:5}}
  };
  asMimic() {return this}
  asMaster(device) {
    this.device = device;
    this.object3D = new THREE.Group(); // Placeholder to add objects to mouse
    document.querySelector("body").setAttribute("oncontextmenu", "return false");
    let world = bc.world;
    this.raycaster = new THREE.Raycaster();
    this.activeTouches = 0;
    this.isIPad = navigator.userAgent.match(/iPad/i) != null;
    if (this.isIPad || device == 'augmented') {
      world.renderer.domElement.addEventListener('touchstart', (evt)=> {
        if (!world.activeEnv) return;
        this.activeTouches += evt.changedTouches.length;
        let touch = evt.changedTouches[0];
        let canvasRect = world.renderer.getContext().canvas.getBoundingClientRect();
        this.mousex = (touch.screenX - canvasRect.left) / canvasRect.width * 2 - 1;
        this.mousey = -(touch.screenY + canvasRect.top) / canvasRect.height * 2 + 1;
        if (this.activeTouches == 1) {
          this.buttonStateMap['Select'] = {pressed:true};
          world.activeEnv.notifyListeners(bc.CONTROLLER_EVENT, {selectState:1, buttonAState:0});
        }
        if (this.activeTouches == 2) {
          this.lastX = null; this.lastY = null;
        }
      })
      world.renderer.domElement.addEventListener('touchmove', (evt)=>{
        if (!world.activeEnv) return;
/*        evt.preventDefault();
        // Only pan on 2 finger touch
        let touch = evt.changedTouches[0];
        var cx = touch.screenX*2;
        var cy = touch.screenY*2;
        if (!this.lastX) this.lastX = cx;
        if (!this.lastY) this.lastY = cy;
        if (evt.changedTouches.length == 2) {
          let cr = bc.world.agent.camera.rotation;
          cr.y -= ((cx-lastX)/100) * this.sensitivity;
          cr.x -= ((cy-lastY)/100) * this.sensitivity;
          this.lastX = cx;
          this.lastY = cy;
        } else {
          let w = evt.target.width;
          let h = evt.target.height;
          this.mousex = cx / w * 2 - 1;
          this.mousey = -(cy / h) * 2 + 1;
        } */
      });
      world.renderer.domElement.addEventListener('touchcancel', (evt)=>{
        console.log('Touch Canceled:', evt.changedTouches.length);
      });
      world.renderer.domElement.addEventListener('touchend', (evt)=>{
        if (!world.activeEnv) return;
        this.activeTouches -= evt.changedTouches.length;
        if (this.activeTouches == 0) {
          if (this.buttonStateMap['Select'].pressed) {
            this.buttonStateMap['Select'] = {pressed:false};
            world.activeEnv.notifyListeners(bc.CONTROLLER_EVENT, {selectState:2, buttonAState:0});
          }
        }
      })
    }
    world.renderer.domElement.addEventListener('mousemove', (event)=>{
      if (!world.activeEnv) return;
      let user = world._identity;
      let canvasRect = world.renderer.getContext().canvas.getBoundingClientRect();
      this.mousex = (event.clientX - canvasRect.left) / canvasRect.width * 2 - 1;
      this.mousey = -(event.clientY - canvasRect.top) / canvasRect.height * 2 + 1;

      if (!this.lastX) this.lastX = event.clientX;
      if (!this.lastY) this.lastY = event.clientY;
      if (event.buttons == 2) {
        let head3D = bc.world.agent.camera;
//          head3D.lookAt(event.clientX/canvasRect.width, 1.6-event.clientY/canvasRect.height, -1);
//console.log('x:', event.clientX);
        head3D.rotation.reorder('YXZ');
        head3D.rotation.y += -(event.clientX-this.lastX)/100 * this.sensitivity;
        head3D.rotation.reorder('ZYX');
        head3D.rotation.x += -(event.clientY-this.lastY)/100 * this.sensitivity;
        head3D.rotation.reorder('YXZ');
        let angle = head3D.rotation.y;
        head3D.rotation.reorder('XYZ');
//          ser.childMap.head.object3D.rotateX(-(event.clientY-this.lastY)/100 * this.sensitivity);
//          head3D.rotateY(-(event.clientX-this.lastX)/100 * this.sensitivity);
        let hRot = head3D.rotation.toVector3();
        this.lastX = event.clientX;
        this.lastY = event.clientY;

        const env = world.activeEnv;
//        let head = bc.world.agent.user.childMap.head;
        const mouseAvatar = env.controllerAvatarMap['generic-mouse-other'];
        mouseAvatar.object3D.rotation.x = head3D.rotation.x;
        mouseAvatar.object3D.rotation.y = head3D.rotation.y;
        mouseAvatar.object3D.rotation.z = head3D.rotation.z;
        env.userBroadcast('UpdateController', bc.world.activeEnv.id, {actionMode:'Move', controllerId:'generic-mouse-other', rX:head3D.rotation.x, rY:head3D.rotation.y, rZ:head3D.rotation.z});
        let handler = mouseAvatar.handler.ref;
        handler.current = mouseAvatar;
        handler.executeRules(handler.onUpdate);

//        this.server.broadcast('controllerUpdate', {id:this.id, x:event.clientX, y:event.clientY});
      }
    });
    world.renderer.domElement.addEventListener('mousedown', (evt) => {
      if (!world.activeEnv) return;
      if(evt.button == 0){
        this.buttonStateMap['Select'] = {pressed:true};
        world.activeEnv.notifyListeners(bc.CONTROLLER_EVENT, {selectState:1, buttonAState:0});
      } else
        {this.lastX = null; this.lastY = null}
    });
    world.renderer.domElement.addEventListener('mouseup', (evt) => {
      if (!world.activeEnv) return;
      this.lastX = null; this.lastY = null;
      if (evt.button == 0) {
        this.buttonStateMap['Select'] = {pressed:false};
        world.activeEnv.notifyListeners(bc.CONTROLLER_EVENT, {selectState:2, buttonAState:0});
      }
    });
    world.renderer.domElement.addEventListener('mouseleave', (evt) => {
      if (!world.activeEnv) return;
      this.lastX = null; this.lastY = null;
    });
    return this;
  }
  getIntersection() {
    let world = bc.world;
    let env = world.activeEnv;
    let camera = world.agent.camera;
    if (this.device != 'augmented') {
//    this.raycaster.ray.origin.setFromMatrixPosition(camera.matrixWorld);
//    this.raycaster.ray.direction.set(this.mousex, this.mousey, 0.5).unproject(camera).sub(this.raycaster.ray.origin).normalize();
      this.raycaster.setFromCamera(new THREE.Vector2(this.mousex, this.mousey), camera) }
    else {
      let cQuat = camera.quaternion.clone();
      const xAxis = new THREE.Vector3(0, 1, 0);
      const xRot = -this.mousex*.5;
      const xQuat = new THREE.Quaternion();
      xQuat.setFromAxisAngle(xAxis, xRot);

      const yAxis = new THREE.Vector3(1, 0, 0);
      const yRot = this.mousey*.5;
      const yQuat = new THREE.Quaternion();
      yQuat.setFromAxisAngle(yAxis, yRot);

      const eQuat = new THREE.Quaternion();
      eQuat.multiplyQuaternions(yQuat, xQuat);
      const quat = new THREE.Quaternion();
      quat.multiplyQuaternions(cQuat, eQuat);

      let dir = new THREE.Vector3( 0, 0, -1 );
      dir.applyQuaternion(quat).normalize();
      this.raycaster.ray.origin.setFromMatrixPosition(camera.matrixWorld);
      this.raycaster.ray.direction.set(dir.x, dir.y, dir.z);
    }

    let ray = this.raycaster.ray;
    let direction = ray.direction;
    let origin = ray.origin;

    let far = 1+this.mousey;
    this.storePosition.x = far * direction.x + origin.x;
    this.storePosition.z = far * direction.z + origin.z;
    this.storeRotation.x = direction.x;
    this.storeRotation.z = direction.z;

    if (!this.isLocked) {
      const intersections = this.raycaster.intersectObjects(env.intersectable3D, true );
      let intersection = null;
      let control = null;
  //if (intersections.length) {console.error('Intersect!!!')}
      for (let i = 0, len = intersections.length; !intersection && i < len; i++) {
        intersection = intersections[i];
        if (intersection.distance > .1) {
          let target3D = intersection.object;
          // First find a handler in the hierarchy attached to threejs object because
          // a control could have a hierarchy of threejs objects.
          while (target3D && !target3D.bcc) target3D = target3D.parent;
          let target = null;
          if (target3D) target = target3D.bcc;

          // Then check the control hierarchy to find a handler that is active and visible.
          while (target) {
            let target3D = target.object3D;
            if (target3D) {
              if (!target3D.visible) {control = null; break} // Ignore intersection with non visibility
              else if (target.unactive) control = null; // discount unactive controls in hierarchy
              else if (target3D.bcc && !control) control = target; // sect new control if not set yet.
            }
            target = target.parent;
          }
          if (control) {intersection.object = control.object3D}
          else intersection = null;
        } else intersection = null;
      }
      this.lastControl = this.control;
      this.control = control;
      this.intersection = intersection;
    }
  }
}
bc.control.Identity = class extends bc.control.Control {
  device = 'browser';
  fov = 80; pushToTalk = false; counter = 0; isActive = false;
  tposition = new THREE.Vector3();
  tquaternion = new THREE.Quaternion();
  tscale = new THREE.Vector3();
  trotation = new THREE.Euler();
  constructor(parent, design) {
    super(parent, design);
    this.targets = []; // Hack - used to figure out focus targets.  Need to make this a class or something with focusControl in it.
    this.world.agent = this;
    this.controllerMap = {};
    this.camera = new THREE.PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.01, 2000);
//    this.readParameters();

    let canvas = document.createElement('canvas');
    let context = canvas.getContext('webgl2', {alpha:false, xrCompatible: true, });
    let renderer = bc.world.renderer = new THREE.WebGLRenderer({canvas:canvas, context:context, antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.outputEncoding = THREE.GammaEncoding;
    renderer.gammaFactor = 2.2;
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight) }, false);
    this.world.textureFormats = {
      astc: renderer.extensions.get( 'WEBGL_compressed_texture_astc' ),
      etc1: renderer.extensions.get( 'WEBGL_compressed_texture_etc1' ),
      s3tc: renderer.extensions.get( 'WEBGL_compressed_texture_s3tc' ),
      pvrtc: renderer.extensions.get( 'WEBGL_compressed_texture_pvrtc' ) };
    this.controllerMap['generic-mouse-other'] = new bc.MouseController().asMaster(this.device);
    this.controllerMap['Keyboard'] = new bc.KeyboardController().asMaster(this.device);
    this.vrSession = null;
    this.isInVR = false;

    var button = document.createElement('div');
    button.setAttribute('id', 'enter-button');
    var iconDot = document.createElement('span');
    iconDot.setAttribute('class', 'iconDot');
    button.appendChild(iconDot);
    var icon = document.createElement('div');
    icon.innerHTML = '&nbsp';
    icon.setAttribute('class', 'icon-webXR');
    iconDot.appendChild(icon);
    document.body.appendChild(button);
    button.onmouseenter = function () {button.style.opacity = '1.0'};
    button.onmouseleave = function () {button.style.opacity = '0.5'};

    if(navigator.xr) {
      this.vrSession = null;
      navigator.xr.isSessionSupported('immersive-vr').then((isSupported)=>{
        if(isSupported){
          let onSessionEnded=()=>{
            this.vrSession.removeEventListener('end', onSessionEnded );
            renderer.xr.setSession( null );
            this.vrSession = null;
            this.isInVR = false;
            this.device = this.identity.device = 'browser';
          }
          Object.assign(button, {style:{class: 'icon-webXR'}});
          button.onclick = ()=>{
            // Hack - setTimeout is needed in Quest because of a bug in headset that
            // can not allow mocrophone access at the same time as XR session so we delay
            // the session just a bit and it works!! UG!!
            setTimeout(()=>{
//              navigator.xr.requestSession('immersive-vr', {requiredFeatures: ['local-floor', 'bounded-floor'], optionalFeatures:['hand-tracking']}).then((session)=>{
              navigator.xr.requestSession('immersive-vr', {requiredFeatures: ['local-floor', 'bounded-floor']}).then((session)=>{
                session.oninputsourceschange = (evt)=>{
                  this.inputSourceHandler(evt)};
                session.addEventListener('end', onSessionEnded );
                renderer.xr.setSession(session);
                this.vrSession = session;
                this.isInVR = true;
                this.device = this.identity.device = 'vr';
              }, (err)=>{console.error(err)});
            }, 1000);
          }
        } else
          {button.onclick = null; button.style.display = 'none'}
      })
    }
    else {
      console.error('XR is not supported')
      button.onclick = null; button.style.display = 'none';
    }
/*    else if('getVRDisplays' in navigator) {
      let showVRNotFound = ()=>{
        button.onclick = null; button.style.display = 'none';
        // HACK: Firefox doesn't recognize setDevice so check for it
        if(renderer.xr.setDevice) renderer.xr.setDevice(null);
        my.isInVR = false;
      }
      let showEnterVR = (device)=>{
          Object.assign(button, {style: {class: 'icon-webVR'}});
          button.onclick=
            ()=> {
              device.isPresenting ? device.exitPresent() : device.requestPresent([{source:renderer.domElement}]).then(
                ()=>{
                  console.log('Presenting to WebVR display');
                  let leftEye = device.getEyeParameters('left');
                  let rightEye = device.getEyeParameters('right');

                  renderer.domElement.width = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
                  renderer.domElement.height = Math.max(leftEye.renderHeight, rightEye.renderHeight);

                  window.cancelAnimationFrame();
                  btn.textContent = 'Exit VR display';
                });
                my.isInVR = device.isPresenting ? false:true
            };
          // HACK: Firefox doesn't recognize setDevice so check for it
          if(renderer.xr.setDevice) renderer.xr.setDevice(device);
      }
      window.addEventListener('vrdisplayconnect', (event)=>{showEnterVR(event.display)}, false);
      window.addEventListener('vrdisplaydisconnect', (event)=>{showVRNotFound()}, false);
      window.addEventListener('vrdisplaypresentchange', (event)=>
        {my.isInVR = event.display.isPresenting ? false:true}, false);
      window.addEventListener('vrdisplayactivate', (event)=>
        {event.display.requestPresent([{source:renderer.domElement}])}, false );
      navigator.getVRDisplays().then((displays)=>{
        if (displays.length > 0 )
          showEnterVR(displays[0]);
        else
          showVRNotFound();
      }).catch(showVRNotFound);
    } */
  }
  get userId() {return this.server.ref.userId}
  getAudioListener() {
    if (!this.audioListener) {
      this.audioListener = new THREE.AudioListener();
      this.camera.add(this.audioListener);
    }
    return this.audioListener;
  }
  findControllerProfile(inputSource) {
    let handedness = inputSource.handedness;
    let profile = null;
    for(let profileI = 0; profileI < inputSource.profiles.length && !profile; profileI++) {
      let profileName = inputSource.profiles[profileI]+'-'+handedness;
      profile = bc.control.Identity.profileMap[profileName];
    }
    return profile;
  }
  inputSourceHandler(evt){
    let controllerMap = this.controllerMap;
    let user = this.identity;
    if(evt.added.length > 0) {
      // Hack - Since getController in Threejs only uses the inputSource index to get
      // it's object3D we have to go through hell to make sure we get the right
      // inputSource.
      let xr = this.world.renderer.xr;
      let inputSources = xr.getSession().inputSources;
      for (let inputI = 0; inputI < inputSources.length; inputI++){
        let inputSource = inputSources[inputI];
        console.log('inputSource:', inputSource);
        let profile = this.findControllerProfile(inputSource);
        if (!profile) {throw 'Can not find controller:' + inputSource}
        else {console.log('profile:', profile)}
        let controller = controllerMap[profile.name];
        if (controller) {
          console.error ('Controller Already Exists:', profile.name);
          controller.inputSource = inputSource;
        } else {
          let handName = profile.handedness + 'Hand';
          let handedness = profile.handedness;
          controller = controllerMap[profile.name] = new bc.HandController(inputSource, profile, xr.getController(inputI));
          this.identity.object3D.add(controller.object3D);
          let selfHandler = this.identity.handler.ref;
          selfHandler.current = this.identity;
          selfHandler.childMap[profile.name].doBuildAction({id:handName}, {id:handName}, selfHandler).then(()=>{
            controller.mesh = selfHandler.childMap[profile.name].current;
            controllerMap['generic-mouse-other'].ignore = true;
          })
        }
      }
    }
    if(evt.removed.length > 0){
      for(let i = 0; i < evt.removed.length; i++){
        let inputSource = evt.removed[i];
        let profile = this.findControllerProfile(inputSource);
        let controller = controllerMap[profile.name];
        if (controller) {
          let handName = profile.handedness + 'Hand';
          controller.mesh.remove();
          delete controllerMap[profile.name];
        } else {
          console.error ('controller lost can not be found:', inputSource);
        }
      }
    }
  }
  async updateState() {
    let controllerMap = this.controllerMap;
    for (let key in controllerMap) {
      let controller = controllerMap[key];
      let control = controller.control;
      let buttonStateMap = controller.buttonStateMap;
      let gamepad = controller.inputSource.gamepad;
      let buttonMap = controller.profile.buttonMap;
      if (!gamepad) {
        // Hack - This means it's not a device with buttons so we exit
        return;
      }
      var changed = false;
      let buttonData = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let bKey in buttonMap) {
        var index = buttonMap[bKey].index;
        if (index < gamepad.buttons.length) {
          var buttonState = buttonStateMap[bKey];
          var button = gamepad.buttons[index];
          if (button.pressed && !buttonState.pressed) buttonData[index] = 1;
          if (!button.pressed && buttonState.pressed) buttonData[index] = 2;
          if (buttonState.pressed != button.pressed) {
            changed = true;
          }
          buttonState.pressed = button.pressed;
        }
      }
      let axisX = gamepad.axes[2];
      let axisY = gamepad.axes[3];
      if (changed || axisX < -.1 || axisX > .1 || axisY < -.1 || axisY > .1) {
        this.world.activeEnv.notifyListeners(bc.CONTROLLER_EVENT, {selectState:buttonData[0], buttonBState:buttonData[5], buttonAState:buttonData[4], axisX:gamepad.axes[2], axisY:gamepad.axes[3]});
      }
    }
  }

  toDesignFromDetail(inMode, inDesign) {
    let design = super.toDesignFromDetail(inMode, inDesign);
    console.log('Identity.design = ', design);
    return {id:this.id, type:'User', device:this.device};
  }
/*  readParameters() {
    // Look for name in the URL
    if(location.search != '') {
      var params = location.search.substring(1).split('&');
      for(var i = 0; i < params.length; i++) {
        var parts = params[i].split('=');
        if(parts[0] == 'name') {
          document.cookie = 'avatarName=' + this.id + '; max-age=' + (90 * 86400);
        } else if(parts[0] == 'ptt') {
          if(parts[1].length > 0) {
            if(parts[1].charAt(0) == 't')
            this.pushToTalk = true;
            else
            this.pushToTalk = false;
            document.cookie = 'pushToTalk=' + this.pushToTalk + '; max-age=' + (90 * 86400);
          }
        }
      }
    }
    // Look for the name in the cookie
    if(document.cookie != '') {
      var list = document.cookie.split('; ');
      for(var i = 0; i < list.length; i++) {
        var parts = list[i].split('=');
        // Only get the name from the cookie if not in the URL
        if(parts[0] == 'avatarName' && this.id == 'unknown')  {
          this.id = parts[1];
        }
      }
    }
  } */
  async animatePromise(inEnv) {
    let process = inEnv.newProcess({name:'Avatar'});
    let now;
    let controllerMap = this.controllerMap;
    do {
      this.handleInputs();
      if (++this.counter >= 6 && this.identity != null && bc.world.activeEnv != null && this.vrSession) {
        let camera = this.camera;

        let user = this.identity;
        if (this.world.renderer.xr.getCamera) camera = this.world.renderer.xr.getCamera(this.camera);
        camera.matrix.decompose(this.tposition, this.tquaternion, this.tscale);
        this.trotation.setFromQuaternion(this.tquaternion, "YXZ");
        let cp = this.tposition;
        let cr = this.trotation;
        let head = bc.world.activeEnv.childMap.userConcept.childMap[bc.world.agent.userId].childMap.head;
        head.object3D.position.x = cp.x;
        head.object3D.position.y = cp.y;
        head.object3D.position.z = cp.z;
        head.object3D.rotation.x = cr.x;
        head.object3D.rotation.y = cr.y;
        head.object3D.rotation.z = cr.z;
        let handler = head.handler.ref;
        handler.current = head;
        handler.executeRules(handler.onUpdate);
        for (let key in controllerMap) {
          let controller = controllerMap[key];
          let mesh = controller.mesh;
          let handedness = controller.profile.handedness;
          if (mesh && (handedness == 'left' || handedness == 'right')) {
            let handName = handedness+'Hand';
            let handLocation = controller.object3D;
            let hp = handLocation.position;
            let hr = new THREE.Euler();
            hr.setFromRotationMatrix(handLocation.matrix);
            let distance = 20;
            if (controller.intersection) {distance = controller.intersection.distance}
            mesh.childMap.distance.value = distance;
            mesh.object3D.position.x = hp.x;
            mesh.object3D.position.y = hp.y;
            mesh.object3D.position.z = hp.z;
            mesh.object3D.rotation.x = hr.x;
            mesh.object3D.rotation.y = hr.y;
            mesh.object3D.rotation.z = hr.z;
            let handler = mesh.handler.ref;
            handler.current = mesh;
            handler.executeRules(handler.onUpdate);
          }
        }
      }
      now = await process.tickWait();
    } while (now > 0);
    inEnv.removeProcess(process);
  }
  handleInputs() {
    let controllerMap = bc.world.agent.controllerMap;
    for (let cKey in bc.world.agent.controllerMap) {controllerMap[cKey].updateState()}
  }
  async initializeEnvironment(inEnv) {
    // Move your identity to the current environment you are in.
//    let selfHandler = inEnv.childMap.userConcept.childMap.self;
//    await selfHandler.doBuildAction({id:this.userId}, {id:this.userId}, selfHandler);
//    bc.world.agent.user = selfHandler.current;
//    await selfHandler.childMap.browserSelfBody.doBuildAction({id:'body'}, {id:'body'}, selfHandler);
    let self = bc.world.agent.user;
    let selfHandler = self.handler.ref;
    let controllerMap = this.controllerMap;
    for (let key in controllerMap) {
      let controller = controllerMap[key];
      controller.isActive = true;
      let handedness = controller.profile.handedness;
      let handName = handedness+'Hand';
      if (handedness == 'left' || handedness == 'right') {
        await selfHandler.childMap[controller.profile.name].doBuildAction({id:handName}, {id:handName}, self.handler.ref);
        selfHandler.current.object3D.add(controller.object3D);
        controller.mesh = selfHandler.childMap[controller.profile.name].current;
      }
    }
    this.animatePromise(inEnv);
/*    let userKeys = inEnv.userKeys;
    for (let userKey in inEnv.userMap) {
      let user = inEnv.userMap[userKey];
      const response = await this.server.directRequest(userKey, 'AddUser', {anchorId:inEnv.id});
      const env = bc.world.activeEnv;
      let otherConcept = env.childMap.userConcept.childMap.other;
      await otherConcept.doBuildAction({id:userKey}, {id:userKey}, otherConcept);
      user.user = otherConcept.current;

      let controllerMap = this.controllerMap;
      for (let key in controllerMap) {
        let controller = controllerMap[key];
        this.server.direct(userKey, 'AddController', {anchorKey:bc.world.activeEnv.id, controllerId:controller.profile.name, controllerType:controller.type});
        console.log('Sending AddController:', controller.profile.name);
      }
    } */
  }
  // don't remove this because it is global.
  remove() {}
  static get profileMap() {return {
    'oculus-touch-left': {
      name:'oculus-touch-left',
      handedness:'left',
      buttonMap:{'Grab':{index:1},'Select':{index:0},'ButtonA':{index:4},'ButtonB':{index:5}}
    },
    'oculus-touch-right': {
      name:'oculus-touch-right',
      handedness:'right',
      buttonMap:{'Grab':{index:1},'Select':{index:0},'ButtonA':{index:4},'ButtonB':{index:5}}
    },
    'generic-trigger-touchpad-left': {
      name:'generic-trigger-touchpad-left',
      handedness:'left',
      buttonMap:{'Grab':{index:1},'Select':{index:2},'ButtonA':{index:4},'ButtonB':{index:5}}
    },
    'generic-trigger-touchpad-right': {
      name:'generic-trigger-touchpad-right',
      handedness:'right',
      buttonMap:{'Grab':{index:1},'Select':{index:2},'ButtonA':{index:4},'ButtonB':{index:5}}
    },
    'oculus-go-left':{
      name:'oculus-go-left',
      handedness:'left',
      buttonMap:{'Grab':{index:1},'Select':{index:0},'ButtonA':{index:4},'ButtonB':{index:5}}
    },
    'oculus-go-right':{
      name:'oculus-go-right',
      handedness:'right',
      buttonMap:{'Grab':{index:1},'Select':{index:0},'ButtonA':{index:4},'ButtonB':{index:5}}
    },
    'oculus-hand-left':{
      name:'oculus-hand-left',
      handedness:'left',
      buttonMap:{'Grab':{index:1},'Select':{index:0},'ButtonA':{index:4},'ButtonB':{index:5}}
    },
    'oculus-hand-right':{
      name:'oculus-hand-right',
      handedness:'right',
      buttonMap:{'Grab':{index:1},'Select':{index:0},'ButtonA':{index:4},'ButtonB':{index:5}}
    }
  }}
  static get definition() {return {name:'Identity', type:bc.CLASS, childMap:{
    waitOnServer:{type:bc.CONTROL, mod:bc.FIELD},
    camera:{type:'_Object3D', mod:bc.FIELD, description:'The agents camera'},
    userId:{type:bc.STRING, mod:bc.TRAIT}
  }}}
};
bc.ControlFactory.newFactory(bc.control.Identity);
bc.control.IdentityAR = class extends bc.control.Control {
  device = 'augmented';
  fov = 80; pushToTalk = false; counter = 0; isActive = false;
  tposition = new THREE.Vector3();
  tquaternion = new THREE.Quaternion();
  tscale = new THREE.Vector3();
  trotation = new THREE.Euler();
  pattern = 'assets/Lib/AR.js-master/data/data/camera_para.dat';
  canvasSizeX = 1280;
  canvasSizeY = 960;
  activeAR = false;
  constructor(parent, design) {
    super(parent, design);
    this.targets = []; // Hack - used to figure out focus targets.  Need to make this a class or something with focusControl in it.
    this.world.agent = this;
    this.controllerMap = {};
    this.storePosition = new THREE.Vector3();
    this.storeRotation = new THREE.Vector3();
//    this.camera = new THREE.PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.01, 2000);
    this.camera = new THREE.Camera();
//    this.world.scene.add(this.camera);
//    this.readParameters();

//    let canvas = document.createElement('canvas');
//    let context = canvas.getContext('webgl2', {alpha:false, xrCompatible: true, });
//    let renderer = this.world.renderer = new THREE.WebGLRenderer({antialias: true, context:context, alpha: true});
    let renderer = this.world.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
		renderer.setClearColor(new THREE.Color('lightgrey'), 0)
		renderer.setSize(this.canvasSizeX, this.canvasSizeY);
		renderer.domElement.style.position = 'absolute'
		renderer.domElement.style.top = '0px'
		renderer.domElement.style.left = '0px'
		document.body.appendChild(renderer.domElement);
    this.world.textureFormats = {
      astc: renderer.extensions.get( 'WEBGL_compressed_texture_astc' ),
      etc1: renderer.extensions.get( 'WEBGL_compressed_texture_etc1' ),
      s3tc: renderer.extensions.get( 'WEBGL_compressed_texture_s3tc' ),
      pvrtc: renderer.extensions.get( 'WEBGL_compressed_texture_pvrtc' ) };
    this.controllerMap['generic-mouse-other'] = new bc.MouseController().asMaster(this.device);
    this.controllerMap['Keyboard'] = new bc.KeyboardController().asMaster(this.device);
    this.vrSession = null;
    this.isInVR = false;

    let arToolkitSource = this.arToolkitSource = new THREEx.ArToolkitSource({
			// to read from the webcam
			sourceType: 'webcam',

			sourceWidth: window.innerWidth > window.innerHeight ? this.canvasSizeX : this.canvasSizeY,
			sourceHeight: window.innerWidth > window.innerHeight ? this.canvasSizeX : this.canvasSizeY,

			// // to read from an image
			// sourceType : 'image',
			// sourceUrl : THREEx.ArToolkitContext.baseURL + '../data/images/img.jpg',

			// to read from a video
			// sourceType : 'video',
			// sourceUrl : THREEx.ArToolkitContext.baseURL + '../data/videos/headtracking.mp4',
		})
    let my = this;
		arToolkitSource.init(function onReady() {my.onReady()});
    window.addEventListener('resize', ()=>{this.onResize()})
  }
  get userId() {return this.server.ref.userId}
  onReady() {
    this.arToolkitSource.domElement.addEventListener('canplay', () => {
      console.log(
        'canplay',
        'actual source dimensions',
        this.arToolkitSource.domElement.videoWidth,
        this.arToolkitSource.domElement.videoHeight
      );
      this.initARContext();
    });
    window.arToolkitSource = this.arToolkitSource;
    setTimeout(() => {this.onResize()}, 2000);
  }
  onResize() {
    this.arToolkitSource.onResizeElement();
    this.arToolkitSource.copyElementSizeTo(this.world.renderer.domElement)
    if (window.arToolkitContext.arController !== null) {
      this.arToolkitSource.copyElementSizeTo(window.arToolkitContext.arController.canvas)
    }
  }
  initARContext() { // create atToolkitContext
    let arToolkitContext = this.arToolkitContext = new THREEx.ArToolkitContext({
      cameraParametersUrl: THREEx.ArToolkitContext.baseURL + 'assets/Lib/AR.js-master/data/data/camera_para.dat',
      detectionMode: 'mono'
    });
    // initialize it
    arToolkitContext.init(() => { // copy projection matrix to camera
      this.camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());

      arToolkitContext.arController.orientation = this.getSourceOrientation();
      arToolkitContext.arController.options.orientation = this.getSourceOrientation();

      console.log('arToolkitContext', arToolkitContext);
      window.arToolkitContext = arToolkitContext;
    })

    // MARKER
    let arMarkerControls = new THREEx.ArMarkerControls(arToolkitContext, this.camera, {
      type: 'pattern',
      patternUrl: THREEx.ArToolkitContext.baseURL + 'assets/Lib/AR.js-master/data/data/patt.hiro',
      // patternUrl : THREEx.ArToolkitContext.baseURL + '../data/data/patt.kanji',
      // as we controls the camera, set changeMatrixMode: 'cameraTransformMatrix'
      changeMatrixMode: 'cameraTransformMatrix'
    })
//    this.world.scene.visible = false;
    console.log('ArMarkerControls', arMarkerControls);
    window.arMarkerControls = arMarkerControls;
  }
  getSourceOrientation() {
    if (!this.arToolkitSource) {
      console.error('Can not find arToolkitSource');
      return null;
    }

    console.log(
      'actual source dimensions',
      this.arToolkitSource.domElement.videoWidth,
      this.arToolkitSource.domElement.videoHeight
    );

    if (this.arToolkitSource.domElement.videoWidth > this.arToolkitSource.domElement.videoHeight) {
      console.log('source orientation', 'landscape');
      return 'landscape';
    } else {
      console.log('source orientation', 'portrait');
      return 'portrait';
    }
  }
  getAudioListener() {
    if (!this.audioListener) {
      this.audioListener = new THREE.AudioListener();
      this.camera.add(this.audioListener);
    }
    return this.audioListener;
  }
  findControllerProfile(inputSource) {}
  inputSourceHandler(evt) {}
  toDesignFromDetail(inMode, inDesign) {
    let design = super.toDesignFromDetail(inMode, inDesign);
    console.log('Identity.design = ', design);
    return {id:this.id, type:'User', device:this.device};
  }
  async animatePromise(inEnv) {
    let process = inEnv.newProcess({name:'Avatar'});
    let now;
    do {
      this.handleInputs();
      let camera = this.camera;
  /*    if (this.world.renderer.xr.getCamera) {
        camera = this.world.renderer.xr.getCamera(this.camera);
        console.log('camera:', camera);
      }*/
      camera.matrix.decompose(this.tposition, this.tquaternion, this.tscale);
      this.trotation.setFromQuaternion(this.tquaternion, "YXZ");
      let cp = this.tposition;
      let cr = this.trotation;

      let head = bc.world.activeEnv.childMap.userConcept.childMap[bc.world.agent.userId].childMap.head;
      head.object3D.position.x = cp.x;
      head.object3D.position.y = cp.y;
      head.object3D.position.z = cp.z;
      head.object3D.rotation.x = cr.x;
      head.object3D.rotation.y = cr.y;
      head.object3D.rotation.z = cr.z;
  //console.log('x:', cp.x, ' y:', cp.y, ' z:',cp.z);
      let handler = head.handler.ref;
      handler.current = head;
      handler.executeRules(handler.onUpdate);
      now = await process.tickWait();
    } while (now > 0);
    inEnv.removeProcess(process);
  }
  handleInputs() {
    let controllerMap = bc.world.agent.controllerMap;
    for (let cKey in bc.world.agent.controllerMap) {controllerMap[cKey].updateState()}
  }
  async initializeEnvironment(inEnv) {
    // Move your identity to the current environment you are in.
    let selfHandler = inEnv.childMap.userConcept.childMap.self;
console.log('selfHandler:', inEnv.childMap.userConcept.childMap);
    await selfHandler.doBuildAction({id:this.userId}, {id:this.userId}, selfHandler);
    bc.world.agent.user = selfHandler.current;
    await selfHandler.childMap.browserARSelfHead.doBuildAction({id:'head'}, {id:'head'}, selfHandler);
//    await selfHandler.childMap.browserSelfBody.doBuildAction({id:'body'}, {id:'body'}, selfHandler);
    let controllerMap = this.controllerMap;
    for (let key in controllerMap) {
      let controller = controllerMap[key];
      controller.isActive = true;
    }
    this.animatePromise(inEnv);
  }
  // don't remove this because it is global.
  remove() {}
  static get profileMap() {return {}}
  static get definition() {return {name:'IdentityAR', type:bc.CLASS, childMap:{
    waitOnServer:{type:bc.CONTROL, mod:bc.ACTION},
    pattern:{type:bc.STRING, mod:bc.FIELD},
    camera:{type:'_Object3D', mod:bc.FIELD, description:'The agents camera'},
    canvasSizeX:{type:bc.INTEGER, mod:bc.FIELD},
    canvasSizeY:{type:bc.INTEGER, mod:bc.FIELD},
    userId:{type:bc.STRING, mod:bc.TRAIT},
    onAREvent:{type:bc.RULES, mod:bc.FIELD},
    activeAR:{type:bc.BOOLEAN, mod:bc.FIELD}
  }}}
};
bc.ControlFactory.newFactory(bc.control.IdentityAR);
bc.control.UserCell = class extends bc.control.Control3D {
  static get definition() {return {name:'UserCell', type:bc.CLASS, childMap:{
    zone:{type:bc.STRING, mod:bc.FIELD, default:'user'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.UserCell);
bc.control.UserPartCell = class extends bc.control.Control3D {
  static get definition() {return {name:'UserPartCell', type:bc.CLASS, childMap:{
    zone:{type:bc.STRING, mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(bc.control.UserPartCell);
bc.control.Text = class extends bc.control.Control3D {
  align = 'center';
  _pad = {}; fontSize = .5; font = null; fontMtl = null; maxHeight = 1000; maxWidth = 1000; minHeight = 0; minWidth = 0; lineSpace = .5;
  text = ''; wordSpace = 0; _width = 1; _height = 1000;
  init(inDesign) {
    // Hack - Currently padding sets top and bottom and left and right depending on design.
    // We can not do this because persistance doesn't know how to react. Script writers
    // must manually set all pad values.
    let pad = inDesign.pad;
    if (pad) {
      if (pad.top != null) {if (pad.bottom == null) {this._pad.bottom = this._pad.top}}
      if (pad.left != null) {if (pad.right == null) {this._pad.right = this._pad.left}}
    }
    if (inDesign.text != null || inDesign.fontSize || inDesign.font || inDesign.width) {
      if (this._pad.top == null) this._pad.top = .1;
      if (this._pad.bottom == null) this._pad.bottom = .1;
      if (this._pad.right == null) this._pad.right = .1;
      if (this._pad.left == null) this._pad.left = .1;
      this.build()
    }
  }
  update(inDesign) {this.init(inDesign)}
  get width() {return this._width}
  set width(inWidth) {this._width = this.minWidth = this.maxWidth = inWidth}
  get height() {return this._height}
  set height(inHeight) {this._height = this.minHeight = this.maxHeight = inHeight}
  get pad() {return this._pad}
  set pad(inPad) {this._pad = inPad}
  build() {
    let font = this.font.ref.value;
    let fontMtl = this.fontMtl.value;
    let parts = this.parts = this.parts ? this.parts : [];
    while (parts.length > 0) this.object3D.remove(parts.pop());
    if (this.wordSpace == 0) {
      let spaceShape1 = font.generateShapes('a', this.fontSize);
      let spaceG1 = new THREE.ShapeBufferGeometry(spaceShape1);
      spaceG1.computeBoundingBox();
      let spaceBB1 = spaceG1.boundingBox;
      this.wordSpace = spaceBB1.max.x - spaceBB1.min.x;
    }
    if (this.text == null) this.text = '';
    let string = this.text;
    let words1 = null;
    if (typeof string != 'number') words1 = string.trim().split(' ');
    else words1 = [string.toString()];
    // Pre condition the word list to seperate the returns by themselves.
    let words = [];
    for (let wI = 0, wLen = words1.length; wI < wLen; wI++) {
      let word = words1[wI];
      if (word != '' && word != '\n') {
        let parts = word.split('\n');
        words.push(parts.shift());
        for (let pI = 0, pLen = parts.length; pI < pLen; pI++) {
          let part = parts[pI];
          words.push('\n');
          if (part != '') words.push(part);
        }
      } else words.push(word);
    }
    let startI = 0;
    let endI = 0;
    let lineWidth = 0;
    let lineHeight = 0;
    let innerWidth = this.minWidth - (this._pad.left+this._pad.right);
    let outerHeight = this._pad.top;
    let firstLine = true;
    while (endI < words.length) {
      let word = words[endI];
      let g;
      if (parts.length <= endI) {
        // If more than one space sperates a word create a place holder Mesh
        if (word == '\n') {
          g = new THREE.PlaneGeometry(0.001, .01);
          parts.push(new THREE.Mesh(g, {}));
        } else if (word == '') {
          g = new THREE.PlaneGeometry(this.wordSpace,.1);
          parts.push(new THREE.Mesh(g, {}));
        } else {
          let shape = font.generateShapes(word, this.fontSize);
          g = new THREE.ShapeBufferGeometry(shape, 3);
          parts.push(new THREE.Mesh(g, fontMtl));
        }
      } else {g = parts[endI].geometry}
      g.computeBoundingBox();
      let bb = g.boundingBox;
      let wordWidth = bb.max.x;
      let saveLineWidth = lineWidth;
      if (lineWidth != 0) lineWidth += this.wordSpace;
      lineWidth += wordWidth;
      let draw = false;
      // Calculate an innerwidth based on first line words.
      if (lineWidth > innerWidth && firstLine) {
        if (lineWidth < this.maxWidth-(this._pad.left+this._pad.right)) {
          innerWidth = lineWidth;
        }
      }

      // If inner width is too big after calculation then reduce word.
      if (innerWidth < wordWidth) {
        lineWidth = saveLineWidth;
        let g;
        do {
          word = word.substring(0, word.length-1);
          let shape = font.generateShapes(word, this.fontSize);
          g = new THREE.ShapeBufferGeometry(shape, 3);
          g.computeBoundingBox();
          let bb = g.boundingBox;
          wordWidth = bb.max.x;
        } while ((saveLineWidth + wordWidth) > this.maxWidth-(this._pad.left+this._pad.right));
        parts[parts.length-1] = new THREE.Mesh(g, fontMtl);
      }
      if (lineWidth <= innerWidth) {
        endI++;
        if (word == '\n') {draw = true}
        else if (endI == words.length) {draw = true}
        if (bb.max.y > lineHeight) {lineHeight = bb.max.y}
      } else {
        // If a new line is completed check that it doesn't
        // exceed maxHeight.  Draw if within size.
        if (outerHeight < (this.maxHeight - lineHeight)) {
          lineWidth = saveLineWidth;
          draw = true;
        } else break;
      }
      this.outerWidth = innerWidth + (this._pad.left+this._pad.right);
      if (draw) {
        let offsetX;
        if (this.align == 'left') offsetX = this._pad.left;
        else if (this.align == 'center') {
          offsetX = this.outerWidth / 2 - lineWidth / 2;
        }
        else offsetX = this.outerWidth - lineWidth - this._pad.right;
        // Add a line space
        if (!firstLine) outerHeight += lineHeight*this.lineSpace;
        else firstLine = false;
        for (let pI = startI; pI < endI; pI++) {
          let text3D = parts[pI];
          bb = text3D.geometry.boundingBox;
          if (pI != startI) offsetX += this.wordSpace;
          text3D.position.set(offsetX, -outerHeight-lineHeight, .02);
          offsetX += bb.max.x;
          this.object3D.add(text3D);
        }
        outerHeight += lineHeight;
        lineHeight = 0;
        lineWidth = 0;
        startI = endI;
      }
    }
    outerHeight += this._pad.bottom;
    this.outerHeight = outerHeight < this.minHeight ? this.minHeight : outerHeight;
    for (let pI = 0, pLen = parts.length; pI < pLen; pI++) {
      let pos = parts[pI].position;
      parts[pI].position.set(pos.x - this.outerWidth/2, pos.y + this.outerHeight / 2, pos.z);
    }
  }
  get size() {
    let s = this.object3D.scale;
    return {x:this.outerWidth*s.x, y:this.outerHeight*s.y, z:.02*s.z}
  }
  static get definition() {return {name:'Text', type:bc.CLASS, childMap:{
    align:{type:bc.STRING, mod:bc.FIELD, default:'center', description:'center, right, left'},
    font:{type:bc.CONTROL, mod:bc.FIELD, description:'Font Control Object'},
    fontMtl:{type:bc.CONTROL, mod:bc.FIELD, description:'Font Material'},
    height:{type:bc.FLOAT, mod:bc.FIELD, default:1000, description:'Maximum Height of Text'},
    lineSpace:{type:bc.FLOAT, mod:bc.FIELD, default:.5, description:'Spacing Between Lines'},
    maxHeight:{type:bc.INTEGER, mod:bc.FIELD, default:1000},
    maxWidth:{type:bc.INTEGER, mod:bc.FIELD, default:1000},
    minHeight:{type:bc.INTEGER, mod:bc.FIELD, default:0},
    minWidth:{type:bc.INTEGER, mod:bc.FIELD, default:0},
    pad:{type:'Padding', mod:bc.FIELD},
    fontSize:{type:bc.FLOAT, mod:bc.FIELD, default:.5, description:'Size of Font'},
    text:{type:bc.STRING, mod:bc.FIELD, default:''},
    wordSpace:{type:bc.FLOAT, mod:bc.FIELD, default:0, description:'Spacing Between Words. Default to size of letter a'},
    width:{type:bc.FLOAT, mod:bc.FIELD, default:1, description:'Maximum Width of Text'},
  }}}
};
bc.ControlFactory.newFactory(bc.control.Text);
bc.control.TextCell = class extends bc.control.Text {
  backMtl = null;
  build() {
    super.build();
    var g = new THREE.BoxGeometry(this.outerWidth, this.outerHeight, .02);
    if (this.back3D) this.object3D.remove(this.back3D);
    if (this.backMtl) {
      this.back3D = new THREE.Mesh(g, this.backMtl.value);
      this.object3D.add(this.back3D);
    }
  }
  remove() {
    this.back3D = null;
    super.remove();
  }
  static get definition() {return {name:'TextCell', type:bc.CLASS, childMap:{backMtl:{type:bc.MATERIAL, mod:bc.FIELD}}}}
};
bc.ControlFactory.newFactory(bc.control.TextCell);
bc.control.BasicTexture = class extends bc.control.Texture {
  url = null; wrapS = THREE.RepeatWrapping; wrapU = THREE.RepeatWrapping;
  init(inDesign) {
    return new Promise((resolve, reject)=>{
      let process = this.processor.newProcess({url:inDesign.url, size:1000});
      let textureLoader = new THREE.TextureLoader();
      textureLoader.load(this.env.buildUrl(this.url),
        (texture)=>{
          texture.encoding = THREE.sRGBEncoding;
		      texture.wrapS = this.wrapS;
		      texture.wrapT = this.wrapU;
          this.value = texture;
          this.processor.removeProcess(process);
          resolve();
        },
        undefined,
        (err)=>{this.processor.removeProcess(process); reject({error:'Text Load Error', url:this.url, err:err})}
      );
    });
  }
  remove(){
    this.value.dispose();
    super.remove();
  }
  static get definition() {return {name:'BasicTexture', type:bc.CLASS, childMap:{
    url:{type:bc.STRING, mod:bc.FIELD},
    wrapS:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.RepeatWrapping},
    wrapU:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.RepeatWrapping}
  }}}
};
bc.ControlFactory.newFactory(bc.control.BasicTexture);
bc.control.CanvasTexture = class extends bc.control.Texture {
  width = 1;
  height = 1;
  pixelDensity = 4096;
  fontStyle = '48px serif';
  fillStyle = 'white';
  strokeStyle = 'white';
  lineWidth = 5;
  _point = new THREE.Vector3();
  init(inDesign) {
    const canvas = this.canvas = document.createElement("CANVAS");
    canvas.width = this.width * this.pixelDensity;
    canvas.height = this.height * this.pixelDensity;
    this.ctx = canvas.getContext("2d", {antialias:true});
    this.value = new THREE.Texture(canvas);

    let url = this.env.buildUrl('assets/canvas.png');
    const image = new Image();
    image.addEventListener('load',()=>{
      console.log('url:', url);
      this.ctx.drawImage(image, 0, 0);
      this.value.needsUpdate = true;
    });
    image.src = url;
  }
  doFillTextAction(inDesign, inDetail) {
    let ctx = this.ctx;
    ctx.font = this.fontStyle;
    ctx.fillStyle = this.fillStyle;
    ctx.strokeStyle = this.strokeStyle;
    ctx.fillText(inDetail, this._point.x, this._point.y);
    this.value.needsUpdate = true;
  }
  doStrokeTextAction(inDesign, inDetail) {
    let ctx = this.ctx;
    ctx.font = this.fontStyle;
    ctx.fillStyle = this.fillStyle;
    ctx.strokeStyle = this.strokeStyle;
    ctx.strokeText(inDetail, this._point.x, this._point.y);
    this.value.needsUpdate = true;
  }
  get doFillRect() {return {x:0, y:0, z:0}}
  doFillRectAction(inDesign, inDetail) {
    let ctx = this.ctx;
    ctx.fillStyle = this.fillStyle;
    ctx.strokeStyle = this.strokeStyle;
    ctx.lineWidth = this.lineWidth;
    ctx.fillRect(this._point.x, this._point.y, inDetail.x, inDetail.y);
    this.value.needsUpdate = true;
  }
  get doMoveTo() {return this._point}
  doMoveToAction(inDesign, inDetail) {
    this._point.x = inDetail.x;
    this._point.y = inDetail.y;
    this._point.z = 0;
  }
  get doMoveToIntersect() {return this._point}
  doMoveToIntersectAction(inDesign, inDetail) {
    this._point.x = inDetail.x * this.width * this.pixelDensity;
    this._point.y = this.height * this.pixelDensity - inDetail.y * this.height * this.pixelDensity;
    this._point.z = 0;
  }
  get doLineToIntersect() {return {x:0, y:0, z:0}}
  doLineToIntersectAction(inDesign, inDetail) {
    let x = inDetail.x * this.width * this.pixelDensity;
    let y = this.height * this.pixelDensity - inDetail.y * this.height * this.pixelDensity;
    if (this._point.x == x && this._point.y == y) {}
    else {
      let ctx = this.ctx;
      ctx.strokeStyle = this.strokeStyle;
      ctx.lineWidth = this.lineWidth;
      ctx.beginPath();
      ctx.moveTo(this._point.x, this._point.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      this._point.x = x;
      this._point.y = y;
      this._point.z = 0;
      this.value.needsUpdate = true;
    }
  }
  doUpdateResourceAction() {
    this.server.socket.emit('updateResource', {url:'/assets/canvas.png', data:this.canvas.toDataURL()});
  }
  handleAnimate(inState, inNow) {
//    if (inState == bc.FINISH) return false;
//    let ctx = this.ctx;
//    let canvas = this.canvas;
//    this.count += this.direction;
//    if (this.count == 2048) this.direction = -1;
//    if (this.count == 0) this.direction = 1;
//    ctx.clearRect(0, 0, canvas.width, canvas.height);
//    ctx.beginPath();
//    ctx.arc(100+this.count, 75+this.count, 10+this.count/2, 0, 2 * Math.PI);
//    ctx.fillStyle = "red";
//    ctx.fill();
//    ctx.stroke();
/*    ctx.font = "180px Ariel";
    ctx.fillStyle = "#FFF";
    ctx.fillText("This is a test of readability of text", 0, 2248);
    ctx.fillText("Here are some numbers 0 1 2 3 4 5", 0, 2448);
    this.value.needsUpdate = true; */
    return true;
  }
  static get definition() {return {name:'CanvasTexture', type:bc.CLASS, childMap:{
    fillStyle:{type:bc.STRING, mod:bc.FIELD, default:'white', description:'Fill Color'},
    strokeStyle:{type:bc.STRING, mod:bc.FIELD, default:'white', description:'Stroke Color'},
    fontStyle:{type:bc.STRING, mod:bc.FIELD, default:'48px serif', description:'Font size and name'},
    lineWidth:{type:bc.INTEGER, mod:bc.FIELD, default:5, description:'Stroke line width'},
    doFillRect:{type:'_Vector', mod:bc.ACTION, description:'Fill Recangle from move point to x,y'},
    doFillText:{type:bc.STRING, mod:bc.ACTION, description:'Fill Text in Canvas'},
    doStrokeText:{type:bc.STRING, mod:bc.ACTION, description:'Stroke Text in Canvas'},
    doMoveTo:{type:'_Vector', mod:bc.ACTION, description:'Move current position'},
    doMoveToIntersect:{type:'_Vector', mod:bc.ACTION, description:'Move current position to intersect position'},
    doLineToIntersect:{type:'_Vector', mod:bc.ACTION, description:'Draw a line from last point to current intersect point'},
    doUpdateResource:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Update the attached resource'},
    width:{type:bc.INTEGER, mod:bc.FIELD, default:1, description:'Width of canvas'},
    height:{type:bc.INTEGER, mod:bc.FIELD, default:1, description:'Height of canvas'},
    pixelDensity:{type:bc.INTEGER, mod:bc.FIELD, default:4096, description:'Pixel Density per 1 meter'}
  }}}
};
bc.ControlFactory.newFactory(bc.control.CanvasTexture);
bc.control.VideoTexture = class extends bc.control.Texture {
  url = null; loop = true; wrapS = THREE.RepeatWrapping; wrapU = THREE.RepeatWrapping;
  isPlaying = false;
  init(inDesign) {
    const videoHtml = this.videoHtml = document.createElement('video');
    videoHtml.id = this.localId;
    videoHtml.muted = this.muted;
    videoHtml.preload = 'none';
//      videoHtml.autoload = true;
    videoHtml.src = this.env.buildUrl(this.url);
    const videoTexture = this.value = new THREE.VideoTexture(videoHtml);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBFormat;
    videoTexture.encoding = THREE.sRGBEncoding;
    if (this.isPlaying) this.playAction();
  }
  playVideo(inVideo) {
    let playPromise = inVideo.play();
    if (playPromise !== undefined) {
      playPromise.then(_ => {
        // Automatic playback started!
        // Show playing UI.
      })
      .catch(error => {
        console.log('Error!!!', error);
        // Auto-play was prevented
        // Show paused UI.
      });
    }
    return playPromise;
  }
  playAction() {
    this.playVideo(this.videoHtml);
    this.videoHtml.addEventListener('ended', ()=>{
      this.videoHtml.pause();
      this.videoHtml.load();
      if (this.loop) {this.playVideo(this.videoHtml)}
    })
  }
  loadAction() {this.videoHtml.load()}
  pauseAction() {this.videoHtml.pause()}
  remove(){
    this.videoHtml.pause();
    this.videoHtml = null;
    this.value.dispose();
    super.remove();
  }
  static get definition() {return {name:'VideoTexture', type:bc.CLASS, childMap:{
    url:{type:bc.STRING, mod:bc.FIELD},
    isPlaying:{type:bc.BOOLEAN, mod:bc.FIELD, description:'Flag denoting if video is playing'},
    loop:{type:bc.BOOLEAN, mod:bc.FIELD, default:true},
    load:{type:bc.BOOLEAN, mod:bc.ACTION},
    play:{type:bc.BOOLEAN, mod:bc.ACTION},
    pause:{type:bc.BOOLEAN, mod:bc.ACTION},
    wrapS:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.ClampToEdgeWrapping},
    wrapU:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.ClampToEdgeWrapping}
  }}}
};
bc.ControlFactory.newFactory(bc.control.VideoTexture);
bc.control.Audio3D = class extends bc.control.Control {
  loop = false; maxDistance = 10; refDistance = 2; volume = .5;
  playAt = null;
  async init(inDesign) {
    if (inDesign.url) await this.loadUrl(inDesign.url);
    if (inDesign.playAt) await this.doPlayAtAction(null, this.playAt)
  }
  async update(inDesign) {
    if (inDesign.playAt) await this.doPlayAtAction(null, this.playAt);
  }
  doPlayAtAction(inDesign, inDetail) {
    if (!this.process) {
      let listener = this.world.agent.getAudioListener();
      this.sound = new THREE.PositionalAudio(listener);
      this.sound.setBuffer(this.value);
      this.sound.setRefDistance(this.refDistance);
      this.sound.setMaxDistance(this.maxDistance);
      this.sound.setVolume(this.volume);
      this.sound.setLoop(this.loop);
      inDetail.ref.object3D.add(this.sound);
      this.doPlayProcess();
    }
    else {console.warn('Sound already playing id:', this.localId, ' this.process:', this.process)}
  }
  async doPlayProcess() {
    let now;
    this.process = this.processor.newProcess();
    this.sound.play();
    do {do {now = await this.process.tickWait()} while (this.sound.isPlaying && now > 0)} while (now > 0 && this.loop);
    this.sound.stop();
    this.processor.removeProcess(this.process);
    this.process = null;
    this.sound = null;
  }
  async doStopAction(inDesign, inDetail) {await this.process.stop()}
  doWaitSyncAction() {return new Promise((resolve, reject)=>{if (this.process) {this.process.onComplete=()=>{resolve()}}})}
  pauseAction(inDesign, inDetail) {this.sound.pause()}
  playAction(inDesign, inDetail) {this.sound.play()}
  stopAction(inDesign, inDetail) {this.removeSound()}
  loadUrl(inDetail) {
    return new Promise((resolve, reject)=>{
      var audioLoader = new THREE.AudioLoader();
      let process = this.processor.newProcess({url:inDetail, size:1000});
      audioLoader.load(this.env.buildUrl(inDetail), (buffer)=>{
        this.value = buffer;
        resolve();
        this.processor.removeProcess(process);
      });
    })
  }
  removeSound() {
    if (this.sound) {
      this.sound.pause();
      if (this.playAt) {
        this.playAt.object3D.remove(this.sound);
        this.playAt = null;
      }
      this.sound = null;
    }
  }
  remove() {this.removeSound(); super.remove()}

  static get definition() {return {name:'Audio3D', type:bc.CLASS, childMap:{
    loop:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    maxDistance:{type:bc.FLOAT, mod:bc.FIELD, default:10},
    pause:{type:bc.BOOLEAN, mod:bc.ACTION},
    play:{type:bc.BOOLEAN, mod:bc.ACTION},
    stop:{type:bc.BOOLEAN, mod:bc.ACTION},
    doStop:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Stop Playing Sound'},
    doWaitSync:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Wait for Sound to finish'},
    doPlayAt:{type:bc.CONTROL, mod:bc.ACTION, description:'Where to play sound'},
    playAt:{type:bc.CONTROL, mod:bc.FIELD, description:'Where to play sound set by actions'}, // definition should be control in the future
    refDistance:{type:bc.FLOAT, mod:bc.FIELD, default:2},
    volume:{type:bc.FLOAT, mod:bc.FIELD, default:.5},
    url:{type:bc.STRING, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Audio3D);
bc.control.GLTF = class extends bc.control.Control3D {
  init(inDesign) {
    return new Promise((resolve, reject)=>{
      if (inDesign.url) {
        let process = this.processor.newProcess({url:inDesign.url, size:1000});
        let loader = new GLTFLoader();
        loader.load(this.env.buildUrl(this.url), (gltf)=>{
            this.value = gltf;
            if (inDesign.material) this.assignMat(gltf.scene, this.material.value);
            if (inDesign.envMap) {
              this.value.scene.traverse((child)=>{if (child instanceof THREE.Mesh) {
                child.material.envMap = this.envMap.value;
                child.material.side = THREE.DoubleSide;
              }});
            }
            this.object3D.add(gltf.scene);
            this.mixer = new THREE.AnimationMixer(gltf.scene);
            this.mixer.addEventListener('finished', (e) => {this.animationAction = null});
            this.processor.removeProcess(process);
            resolve();
          },
          undefined, (err)=>{reject({status:'GLTF Load Error:', e:err})}
        );
      } else {resolve()}
    });
  }
  playAction(inDesign, inDetail) {this.doPlayPromise(inDetail)}
  async doPlayPromise(inDetail) {
    let process = this.processor.newProcess({name:'GLTF'});
    let clip = THREE.AnimationClip.findByName(this.value.animations, inDetail);
    let animationAction = this.mixer.clipAction(clip).play();
    animationAction.reset();
    animationAction.loop = THREE.LoopOnce;

    let now = Date.now();
    let lastTime = now;
    while (now > 0 && animationAction.isRunning()) {
      let diff = (now - lastTime) / 1000;
      if (diff > 0) this.mixer.update(diff);
      lastTime = now;
      now = await process.tickWait();
    }
    this.mixer.stopAllAction();
    this.animationAction = null;
    this.processor.removeProcess(process);
  }
  static get definition() {return {name:'GLTF', type:bc.CLASS, childMap:{
    url:{type:bc.STRING, mod:bc.FIELD},
    material:{type:bc.CONTROL, mod:bc.FIELD},
    play:{type:bc.STRING, mod:bc.ACTION},
    envMap:{type:bc.CONTROL, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(bc.control.GLTF);
bc.control.LineBasicMesh = class extends bc.control.Control3D {
  color = 0x0000ff;
  init(inDesign) {
    if (inDesign.length != null || inDesign.color != null) {
      if (this.value) this.object3D.remove(this.value);
      let g;
      if (inDesign.to) {
        let wp = this.worldPosition;
        let fwp = new THREE.Vector3();
        fwp.copy(this.parent.object3D.position);
        let twp = new THREE.Vector3();
        twp.copy(this.to.ref.object3D.position);
        let to = new THREE.Vector3(twp.x - fwp.x, twp.y - fwp.y, twp.z - fwp.z);
        g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), to]);
      }
      else {g = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 0, - 1 ) ] )}
      let m = new THREE.LineBasicMaterial({color:this.color});
      this.value = new THREE.Line(g, m);
      this.object3D.add(this.value);
    }
  }
  set length(inDetail) {this.object3D.scale.z = inDetail}
  get length() {return this.object3D.scale.z}
  static get definition() {return {name:'LineBasicMesh', type:bc.CLASS, childMap:{
    length:{type:bc.INTEGER, mod:bc.FIELD, default:1, description:'change size.z'},
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0x0000ff},
    to:{type:bc.CONTROL, mod:bc.FIELD, description:'an optional destination control for the line'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.LineBasicMesh);
bc.control.MeshBasicMaterial = class extends bc.control.Material {
  value = new THREE.MeshBasicMaterial(); _color = 0xffffff;
  get side() {return this.value.side} set side(inValue) {this.value.side = inValue}
  get blending() {return this.value.blending} set blending(inValue) {this.value.blending = inValue}
  get transparent() {return this.value.transparent} set transparent(inValue) {this.value.transparent = inValue}
  get needsUpdate() {return this.value.needsUpdate} set needsUpdate(inValue) {this.value.needsUpdate = inValue}
  get color() {return this._color} set color(inValue) {this._color = inValue; this.value.color = new THREE.Color(inValue).convertSRGBToLinear()}
  get opacity() {return this.value.opacity} set opacity(inValue) {this.value.opacity = inValue}
  get map() {return this._map} set map(inValue) {this._map = inValue; this.value.map = inValue.value}
  get envMap() {return this._envMap} set envMap(inValue) {this._envMap = inValue; this.value.envMap = inValue.value}
  get alphaMap() {return this._alphaMap} set alphaMap(inValue) {this._alphaMap = inValue; this.value.alphaMap = inValue.value}
  remove(){
    this.value.dispose();
    this.removeChild(this.map);
    this.removeChild(this.envMap);
    this.removeChild(this.alphaMap);
    super.remove()}
  static get definition() {return {name:'BasicMaterial', type:bc.CLASS, childMap:{
    side:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.FrontSide},
    blending:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.NormalBlending},
    transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    needsUpdate:{type:bc.BOOLEAN, mod:bc.FIELD, default:true},
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0xffffff},
    opacity:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    map:{type:bc.TEXTURE, mod:bc.FIELD},
    envMap:{type:bc.TEXTURE, mod:bc.FIELD},
    alphaMap:{type:bc.TEXTURE, mod:bc.FIELD}}}}
}
bc.ControlFactory.newFactory(bc.control.MeshBasicMaterial, {color: {type: 'RGBColor'}});
bc.control.SmartTexture = class extends bc.control.Texture {
  url = null;
  init(inDesign) {
    // HACK - If we don't detect ASTC format then use png.
    if (inDesign.url) {
      let urlParts = this.url.split('.');
      let textureType = "." + urlParts.pop();
      let loadKTX = false;
      let defaultTexture = this.env.defaultTexture;
      if (defaultTexture) {
        if (defaultTexture == 'ktx') {
          if (this.world.textureFormats.astc) {	//ASTC is the best option and should be treated as default - assume unlabeled .ktx files are ASTC
            textureType = ".ktx"; loadKTX = true;
          }
        } else if (defaultTexture == 'allktx') {
          if (this.world.textureFormats.astc) {	//ASTC is the best option and should be treated as default - assume unlabeled .ktx files are ASTC
            textureType = ".ktx"; loadKTX = true;
          } else if (this.world.textureFormats.s3tc) {
            textureType = "-dxt.ktx"; loadKTX = true;
          } else if (this.world.textureFormats.pvrtc) {			//note that PVRTC textures must be LINEAR for now. I'll complain to the ThreeJS devs eventually. Does not cause visual problems as far as I know.
            textureType = "-pvrtc.ktx"; loadKTX = true;
          } else if (this.world.textureFormats.etc) {
            textureType = "-etc2.ktx"; loadKTX = true;
          } else if (this.world.textureFormats.etc1) {
            textureType = "-etc1.ktx"; loadKTX = true;
          }
        }
      }
      let url = this.env.buildUrl(urlParts.join('.') + textureType);
      return new Promise((resolve, reject)=>{
        let process = this.processor.newProcess({url:url, size:1000});
        if (loadKTX) {
          let loader = new KTXLoader();
          loader.load(url, (texture) => {
            texture.encoding = THREE.sRGBEncoding;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            this.value = texture;
            this.processor.removeProcess(process);
            resolve();
          }, undefined, (err) => {console.error(err)});
        } else {
          let loader = new THREE.TextureLoader();
          loader.load(url, (texture) => {
            texture.encoding = THREE.sRGBEncoding;
    		    texture.wrapS = THREE.RepeatWrapping;
    		    texture.wrapT = THREE.RepeatWrapping;
            this.value = texture;
            this.processor.removeProcess(process);
            resolve();
          }, undefined, (err) => {console.error(err);});
        }
      })
    }
  }
  remove(){this.value.dispose(); super.remove()}
  static get definition() {return {name:'SmartTexture', type:bc.CLASS, childMap:{
//    defaultTexture:{type:bc.STRING, mod:bc.FIELD, description:'default type of compression wanted'},
    url:{type:bc.STRING, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(bc.control.SmartTexture);
bc.control.MeshStandardMaterial = class extends bc.control.Material {
  value = new THREE.MeshStandardMaterial(); _color = 0xffffff; _emissive = 0x000000;
  get alphaMap() {return this._alphaMap} set alphaMap(inValue) {this._alphaMap = inValue; this.value.alphaMap = inValue.value}
  get aoMapIntensity() {return this.value.aoMapIntensity} set aoMapIntensity(inValue) {this.value.aoMapIntensity = inValue}
  get aoMap() {return this._aoMap} set aoMap(inValue) {this._aoMap = inValue; this.value.aoMap = inValue.value}
  get blending() {return this.value.blending} set blending(inValue) {this.value.blending = inValue}
  get color() {return this._color} set color(inValue) {this._color = inValue; this.value.color = new THREE.Color(inValue).convertSRGBToLinear()}
  get emissive() {return this._emissive} set emissive(inValue) {this._emissive = inValue; this.value.emissive = new THREE.Color(inValue).convertSRGBToLinear()}
  get emissiveIntensity() {return this.value.emissiveIntensity} set emissiveIntensity(inValue) {this.value.emissiveIntensity = inValue}
  get emissiveMap() {return this._emissiveMap} set emissiveMap(inValue) {this._emissiveMap = inValue; this.value.emissiveMap = inValue.value}
  get envMap() {return this._envMap} set envMap(inValue) {this._envMap = inValue; this.value.envMap = inValue.value}

  get map() {return this._map} set map(inValue) {this._map = inValue; this.value.map = inValue.value}
  get metalness() {return this.value.metalness} set metalness(inValue) {this.value.metalness = inValue}
  get metalnessMap() {return this._metalnessMap} set metalnessMap(inValue) {this._metalnessMap = inValue; this.value.metalnessMap = inValue.value}
  get normalMap() {return this._normalMap} set normalMap(inValue) {this._normalMap = inValue; this.value.normalMap = inValue.value}
  get opacity() {return this.value.opacity} set opacity(inValue) {this.value.opacity = inValue}
  get roughness() {return this.value.roughness} set roughness(inValue) {this.value.roughness = inValue}
  get roughnessMap() {return this._roughnessMap} set roughnessMap(inValue) {this._roughnessMap = inValue; this.value.roughnessMap = inValue.value}
  get side() {return this.value.size} set side(inValue) {this.value.side = inValue}
  get transparent() {return this.value.transparent} set transparent(inValue) {this.value.transparent = inValue}
  remove(){
    this.value.dispose();
    this.removeChild(this.alphaMap);
    this.removeChild(this.aoMap);
    this.removeChild(this.emissiveMap);
    this.removeChild(this.envMap);
    this.removeChild(this.map);
    this.removeChild(this.metalnessMap);
    this.removeChild(this.normalMap);
    this.removeChild(this.roughnessMap);
    super.remove()
  }
  static get definition() {return {name:'StandardMaterial', type:bc.CLASS, childMap:{
    alphaMap:{type:bc.TEXTURE, mod:bc.FIELD},
    aoMapIntensity:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    aoMap:{type:bc.TEXTURE, mod:bc.FIELD},
    blending:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.NormalBlending},
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0xffffff},
    emissive:{type:bc.FLOAT, mod:bc.FIELD, default:0x000000},
    emissiveIntensity:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    emissiveMap:{type:bc.TEXTURE, mod:bc.FIELD},
    envMap:{type:bc.TEXTURE, mod:bc.FIELD},
    map:{type:bc.TEXTURE, mod:bc.FIELD},
    metalness:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    metalnessMap:{type:bc.TEXTURE, mod:bc.FIELD},
    normalMap:{type:bc.TEXTURE, mod:bc.FIELD},
    opacity:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    roughness:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    roughnessMap:{type:bc.TEXTURE, mod:bc.FIELD},
    side:{type:bc.INTEGER, mod:bc.FIELD, default:THREE.FrontSide},
    transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
  }}}
}
bc.ControlFactory.newFactory(bc.control.MeshStandardMaterial);
bc.control.Font = class extends bc.control.Control {
  init(inDesign) {
    if (this.url) {
      return new Promise((resolve, reject)=>{
        let process = this.processor.newProcess({url:this.url, size:1000});
        new THREE.FontLoader().load(this.env.buildUrl(this.url), (font)=>{this.value = font; this.processor.removeProcess(process); resolve()});
      })
    }
  }
  static get definition() {return {name:'Font', type:bc.CLASS, childMap:{url:{type:bc.STRING, mod:bc.FIELD}}}}
}
bc.ControlFactory.newFactory(bc.control.Font, {url: {type: 'String'}});
bc.control.CubeMapTexture = class extends bc.control.Texture {
  init(inDesign) {
    return new Promise((resolve, reject)=>{
      let urls = null;
      if (inDesign.urls) urls = inDesign.urls;  // Legacy
      else urls = [inDesign.right, inDesign.left, inDesign.top, inDesign.bottom, inDesign.front, inDesign.back];
      let process = this.processor.newProcess({url:urls, size:1000});
      let texture = new THREE.CubeTextureLoader().setPath(this.path).load(
        urls,
        (texture) => {this.value = texture; this.processor.removeProcess(process); resolve()}
      );
    })
  }
  static get definition() {return {name:'CubeMapTexture', type:bc.CLASS, childMap:{
    path:{type:bc.STRING, mod:bc.FIELD},
    urls:{type:bc.DATA, mod:bc.FIELD},
    right:{type:bc.STRING, mod:bc.FIELD},
    left:{type:bc.STRING, mod:bc.FIELD},
    top:{type:bc.STRING, mod:bc.FIELD},
    bottom:{type:bc.STRING, mod:bc.FIELD},
    front:{type:bc.STRING, mod:bc.FIELD},
    back:{type:bc.STRING, mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(bc.control.CubeMapTexture);
bc.control.HDRCubeMapTexture = class extends bc.control.Texture {
  init(inDesign) {
    if (inDesign.url) {
      return new Promise((resolve, reject)=>{
        let xhr = new XMLHttpRequest();
        let process = this.processor.newProcess({url:this.url, size:1000});
        xhr.open('GET', this.env.buildUrl(this.url));
        xhr.responseType = 'arraybuffer';
        xhr.onload = (e)=>{
          if (xhr.status == 200) {
           let imgBuffer = new Uint8Array(xhr.response);
           //pmremGenerator always outputs 768x768 regardless of input; this might change
           let bakedTexture = this.value = new THREE.DataTexture( imgBuffer, 768, 768, THREE.RGBAformat, THREE.UnsignedByteType );
           bakedTexture.encoding = THREE.RGBEEncoding;
           bakedTexture.mapping = THREE.CubeUVReflectionMapping;
           this.processor.removeProcess(process);
           resolve(); }
          else {reject({error:'Unknown Texture', url:this.url, status:xhr.status})}
        };
        xhr.onerror = (e)=>{this.processor.removeProcess(process); reject(e)}
        xhr.send();
      });
    }
  }
  static get definition() {return {name:'HDRCubeMapTexture', type:bc.CLASS, childMap:{url:{type:bc.STRING, mod:bc.FIELD}}}}
}
bc.ControlFactory.newFactory(bc.control.HDRCubeMapTexture);
bc.control.ObjectMesh = class extends bc.control.Control3D {
  init(inDesign) {
    if (inDesign.url) {
      return new Promise((resolve, reject)=>{
        let objUrl = this.url;
        let process = this.processor.newProcess({url:this.url, size:1000});
        let pathParts = objUrl.split('/');
        let name = pathParts.pop();
        let path = pathParts.join('/')+'/';
        let nameParts = name.split('.');
        nameParts.pop();
        let prefix = nameParts.join('.');
        let mtlUrl = path+prefix+'.mtl';
        let mtlLoader = new MTLLoader();
        mtlLoader.load(mtlUrl, (materials)=>{
          materials.preload();
          let objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.load(objUrl, (object) =>{
            this.object3D.add(object);
            this.processor.removeProcess(process);
            resolve();
          });
        });
      })
    }
  }
  remove() {
    // HACK - for some reason removing geometry causes and error in renderer.
    this.object3D.traverse(function(child){if (child instanceof THREE.Mesh && child.geometry != null) child.geometry.dispose()});
    super.remove();
  }
  static get definition() {return {name:'ObjectMesh', type:bc.CLASS, childMap:{url:{type:bc.STRING, mod:bc.FIELD}}}}
}
bc.ControlFactory.newFactory(bc.control.ObjectMesh);
bc.control.FBXMesh = class extends bc.control.Control3D {
  init(inDesign) {
    if (inDesign.url) {
      return new Promise((resolve, reject)=>{
        let process = this.processor.newProcess({url:inDesign.url, size:1000});
        let loader = new FBXLoader();
        loader.load(inDetail.url, (object)=>{
          this.value = object;
          this.mixer = new THREE.AnimationMixer(object);
          this.mixer.addEventListener('finished', (e) => {this.animationAction = null});
          this.object3D.add(object);
          this.processor.removeProcess(process);
          resolve();
        });
      })
    }
  }
  doPlay(inDesign, inDetail) {
    // Needs updating!!!
    debugger;
    let clip = this.value.animations[0];
//    let clip = THREE.AnimationClip.findByName(this.value.animations, inDetail);
    this.animationAction = this.mixer.clipAction(clip);
    this.animationAction.reset();
    this.animationAction.play();
    this.animationAction.loop = THREE.LoopOnce;
    return this.env.sendAnimateEvent(this);
  }
  handleAnimate(inRequest) {
    this.mixer.update(.016666);
    if (!inRequest.isActive && this.animationAction) {
      this.mixer.stopAllAction();
      this.animationAction = null;
    };
    return this.animationAction ? true : false;
  }
  remove() {
    // HACK - for some reason removing geometry causes and error in renderer.
    this.object3D.traverse(function(child){if (child instanceof THREE.Mesh && child.geometry != null) child.geometry.dispose()});
    super.remove();
  }
  static get definition() {return {name:'FBXMesh', type:bc.CLASS, childMap:{
    url:{type:bc.STRING}, doPlay:{type:bc.STRING, mod:bc.ACTION} }}}
}
bc.ControlFactory.newFactory(bc.control.FBXMesh);
bc.control.ColladaMesh = class extends bc.control.Control3D {
  init(inDesign) {
    if (inDesign.url) {
      return new Promise((resolve, reject)=>{
        let process = this.processor.newProcess({url:inDesign.url, size:1000});
        let loader = new ColladaLoader();
        loader.load(inDetail.url, (collada)=>{
          this.value = collada.scene;
          this.mixer = new THREE.AnimationMixer(collada.scene);
          this.mixer.addEventListener('finished', (e) => {this.animationAction = null});
          this.object3D.add(collada.scene);
          this.processor.removeProcess(process);
          resolve();
        });
      })
    }
  }
  doPlay(inDesign, inDetail) {
    let clip = this.value.animations[0];
//    let clip = THREE.AnimationClip.findByName(this.value.animations, inDetail);
    this.animationAction = this.mixer.clipAction(clip);
    this.animationAction.reset();
    this.animationAction.play();
    this.animationAction.loop = THREE.LoopOnce;
    return this.env.sendAnimateEvent(this);
  }
  handleAnimate(inRequest) {
    this.mixer.update(.016666);
    if (!inRequest.isActive && this.animationAction) {
      this.mixer.stopAllAction();
      this.animationAction = null;
    };
    return this.animationAction ? true : false;
  }
  remove() {
    // HACK - for some reason removing geometry causes and error in renderer.
    this.object3D.traverse(function(child){if (child instanceof THREE.Mesh && child.geometry != null) child.geometry.dispose()});
    super.remove();
  }
  static get definition() {return {name:'ColladaMesh', type:bc.CLASS, childMap:{
    url:{type:bc.STRING}, doPlay:{type:bc.STRING, mod:bc.ACTION} }}}
}
bc.ControlFactory.newFactory(bc.control.ColladaMesh);
bc.control.ExtrudeGeometry = class extends bc.control.Geometry {
  shape = null; depth = .05; bevelEnabled = true; bevelSegments = 2; bevelSize = .01; bevelThickness = .01;
  init(inDesign) {
    let extrudeSettings = { depth:this.depth, bevelEnabled:this.bevelEnabled, bevelSegments:this.bevelSegments, steps:this.steps,
      bevelSize:this.bevelSize, bevelThickness:this.bevelThickness};
    this.value = new THREE.ExtrudeGeometry(this.shape.value, extrudeSettings );
    this.value.center();
  }
  get box() {
    let box = super.box;
    return box;
  }
  static get definition() {return {name:'ExtrudeGeometry', type:bc.CLASS, childMap:{
    shape:{type:bc.CONTROL, mod:bc.FIELD},
    depth:{type:bc.FLOAT, mod:bc.FIELD, default:.05},
    bevelEnabled:{type:bc.BOOLEAN, mod:bc.FIELD, default:true},
    bevelSegments:{type:bc.INTEGER, mod:bc.FIELD, default:2},
    bevelSize:{type:bc.FLOAT, mod:bc.FIELD, default:.01},
    bevelThickness:{type:bc.FLOAT, mod:bc.FIELD, default:.01}
  }}}
}
bc.ControlFactory.newFactory(bc.control.ExtrudeGeometry);
bc.control.RectangleShape = class extends bc.control.Control {
  width = 1; height = 1; radius = 1;
  init(inDesign) {
    let shape = new THREE.Shape();
    let width = this.width;
    let height = this.height;
    let radius = this.radius;
    let x = 0;
    let y = 0;
//    width = 50; height = 50; radius = 20;
    shape.moveTo( x, y + radius );
    shape.lineTo( x, y + height - radius );
    if (radius) shape.quadraticCurveTo( x, y + height, x + radius, y + height );
    shape.lineTo( x + width - radius, y + height );
    if (radius) shape.quadraticCurveTo( x + width, y + height, x + width, y + height - radius );
    shape.lineTo( x + width, y + radius );
    if (radius) shape.quadraticCurveTo( x + width, y, x + width - radius, y );
    shape.lineTo( x + radius, y );
    if (radius) shape.quadraticCurveTo( x, y, x, y + radius );
    this.value = shape;
  }
  static get definition() {return {name:'RectangleShape', type:bc.CLASS, childMap:{
    width:{type:bc.FLOAT, mod:bc.FIELD, default:1}, height:{type:bc.FLOAT, mod:bc.FIELD, default:1}, radius:{type:bc.FLOAT, mod:bc.FIELD, default:1}
  }}}
}
bc.ControlFactory.newFactory(bc.control.RectangleShape);
bc.control.ObjectGeometry = class extends bc.control.Geometry {
  get box() {
    let box = new THREE.Box3().setFromObject(this.value);
    return {min:new THREE.Vector3(box.min.x, box.min.y, box.min.z), max:new THREE.Vector3(box.max.x, box.max.y, box.max.z)};
  }
  init(inDesign) {
    if (inDesign.url) {
      return new Promise((resolve, reject)=>{
        let process = this.processor.newProcess({url:this.url, size:1000});
        let loader = new OBJLoader();
        loader.load(this.env.buildUrl(this.url), (object)=>{
          this.value = object;
          object.traverse((child)=>{
            if (child instanceof THREE.Mesh) {
              let geometry = child.geometry;
              if (geometry && geometry.attributes.uv)
                geometry.setAttribute('uv2', new THREE.BufferAttribute(geometry.attributes.uv.array, 2));
            }
          });
          this.processor.removeProcess(process);
          resolve();
        });
      })
    }
  }
  remove() {
    // HACK - for some reason removing geometry causes and error in renderer.
    if (this.value) this.value.traverse(function(child){if (child instanceof THREE.Mesh && child.geometry != null) child.geometry.dispose()});
    super.remove();
  }
  static get definition() {return {name:'Object', type:bc.CLASS, childMap:{url:{type:bc.STRING, mod:bc.FIELD}}}}
}
bc.ControlFactory.newFactory(bc.control.ObjectGeometry);
bc.control.CircleGeometry = class extends bc.control.Geometry {
  radius = 1; segments = 8; thetaStart = 0; thetaLength = Math.PI*2;
  init(inDesign) {this.value = new THREE.CircleGeometry(this.radius, this.segments, this.thetaStart, this.thetaLength)}
  update(inDesign) {this.value.dispose(); this.init(inDesign)}
  static get definition() {return {name:'CircleGeometry', type:bc.CLASS, childMap:{
    radius:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    segments:{type:bc.INTEGER, mod:bc.FIELD, default:8},
    thetaStart:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    thetaLength:{type:bc.FLOAT, mod:bc.FIELD, default:Math.PI*2}
  }}}
}
bc.ControlFactory.newFactory(bc.control.CircleGeometry);
bc.control.CylinderGeometry = class extends bc.control.Geometry {
  height = 1; heightSegments = 1; radialSegments = 8; radiusTop = 1; radiusBottom = 1; thetaStart = 0; thetaLength = Math.PI*2;
  init(inDesign) {
    this.value = new THREE.CylinderGeometry(this.radiusTop, this.radiusBottom, this.height, this.radialSegments,
      this.heightSegments, this.openEnded, this.thetaStart, this.thetaLength);
  }
  update(inDesign) {this.value.dispose(); this.init(inDesign)}
  static get definition() {return {name:'CylinderGeometry', type:bc.CLASS, childMap:{
    height:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    heightSegments:{type:bc.INTEGER, mod:bc.FIELD, default:1},
    radialSegments:{type:bc.INTEGER, mod:bc.FIELD, default:8},
    radiusTop:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    radiusBottom:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    thetaStart:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    thetaLength:{type:bc.FLOAT, mod:bc.FIELD, default:Math.PI*2}
  }}}
}
bc.ControlFactory.newFactory(bc.control.CylinderGeometry);
bc.control.SphereGeometry = class extends bc.control.Geometry {
  heightSegments = 6; radius = 1; widthSegments = 8; phiStart = 0; phiLength = Math.PI*2; thetaStart = 0; thetaLength = Math.PI;
  init(inDesign) {
    this.value = new THREE.SphereGeometry(this.radius, this.widthSegments, this.heightSegments,
      this.phiStart, this.phiLength, this.thetaStart, this.thetaLength);
  }
  update(inDesign) {this.value.dispose(); this.init(inDesign)}
  static get definition() {return {name:'SphereGeometry', type:bc.CLASS, childMap:{
    heightSegments:{type:bc.INTEGER, mod:bc.FIELD, default:6},
    radius:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    widthSegments:{type:bc.INTEGER, mod:bc.FIELD, default:8},
    phiStart:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    phiLength:{type:bc.FLOAT, mod:bc.FIELD, default:Math.PI*2},
    thetaStart:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    thetaLength:{type:bc.FLOAT, mod:bc.FIELD, default:Math.PI}
  }}}
}
bc.ControlFactory.newFactory(bc.control.SphereGeometry);
bc.control.BoxGeometry = class extends bc.control.Geometry {
  x = 1; y = 1; z = 1;
  init(inDesign) {this.value = new THREE.BoxGeometry(this.x, this.y, this.z)}
  update(inDesign) {this.value.dispose(); this.init(inDesign)}
  static get definition() {return {name:'BoxGeometry', type:bc.CLASS, childMap:{
    x:{type:bc.FLOAT, mod:bc.FIELD, default:1}, y:{type:bc.FLOAT, mod:bc.FIELD, default:1}, z:{type:bc.FLOAT, mod:bc.FIELD, default:1}
  }}}
}
bc.ControlFactory.newFactory(bc.control.BoxGeometry);
bc.control.PlaneGeometry = class extends bc.control.Geometry {
  width = 1; height = 1; widthSegments = 1; heightSegments = 1;
  init(inDesign) {this.value = new THREE.PlaneGeometry(this.width, this.height, this.widthSegments, this.heightSegments)}
  update(inDesign) {this.value.dispose(); this.init(inDesign)}
  static get definition() {return {name:'PlaneGeometry', type:bc.CLASS, childMap:{
    width:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    height:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    widthSegments:{type:bc.INTEGER, mod:bc.FIELD, default:1},
    heightSegments:{type:bc.INTEGER, mod:bc.FIELD, default:1}
  }}}
}
bc.ControlFactory.newFactory(bc.control.PlaneGeometry);
bc.control.TorusKnotGeometry = class extends bc.control.Geometry {
  radius = 1; tube = 0.4; tubularSegments = 64; radialSegments = 8; p = 2; q = 3;
  init(inDesign) {this.value = new THREE.TorusKnotGeometry(this.radius, this.tube, this.tubularSegments, this.radialSegments, this.p, this.q)}
  update(inDesign) {this.value.dispose(); this.init(inDesign)}
  static get definition() {return {name:'TorusKnotGeometry', type:bc.CLASS, childMap:{
    radius:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    tube:{type:bc.FLOAT, mod:bc.FIELD, default:0.4},
    tubularSegments:{type:bc.INTEGER, mod:bc.FIELD, default:64},
    radialSegments:{type:bc.INTEGER, mod:bc.FIELD, default:8},
    p:{type:bc.FLOAT, mod:bc.FIELD, default:2},
    q:{type:bc.FLOAT, mod:bc.FIELD, default:3}
  }}}
}
bc.ControlFactory.newFactory(bc.control.TorusKnotGeometry);
bc.control.TorusGeometry = class extends bc.control.Geometry {
  radisu = 1; tube = .4; radialSegments = 8; tubularSegments = 64; arc = Math.PI;
  init(inDesign) {this.value = new THREE.TorusBufferGeometry(this.radius, this.tube, this.radialSegments, this.tubularSegments, this.arc)}
  update(inDesign) {this.value.dispose(); this.init(inDesign)}
  static get definition() {return {name:'TorusGeometry', type:bc.CLASS, childMap:{
    radius:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    tube:{type:bc.FLOAT, mod:bc.FIELD, default:0.4},
    radialSegments:{type:bc.INTEGER, mod:bc.FIELD, default:8},
    tubularSegments:{type:bc.INTEGER, mod:bc.FIELD, default:64},
    arc:{type:bc.FLOAT, mod:bc.FIELD, default:Math.PI}
  }}}
}
bc.ControlFactory.newFactory(bc.control.TorusGeometry);
bc.control.ImageMesh = class extends bc.control.Control3D {
  _map = null; _envMap = null; _color = 0xffffff;
  originalSize = {};
//  absoluteSize = {};
  useUnitScale = false;
  material = new THREE.MeshBasicMaterial({side:2, opacity:1, blending:1, color:new THREE.Color(0xffffff), transparent:true}); _color = 0xffffff;
  /* REDESIGN - originalSize and useUnitScale should be removed.
     AbsoluteSize should be the threejs width (like all other geometry and not a pixel size).
     The axis should scale according to the first absolute axis given as not to "stretch" the image.
     If image stretching is needed then the script writter should build the components himself and not use this funciton.
  */
  init(inDesign) {
    if (inDesign.map) {
      let map = this.material.map;
      let envMap = this.material.envMap;
      if (this.value) this.object3D.remove(this.value);
      let size = this._size = new THREE.Vector3(map.image.width/1000, map.image.height/1000, 0);
      let originalSize = this.originalSize;
  	  if (originalSize) {	//rescales the image as if it had the specified pixel dimensions
    		if (originalSize.x != null) {size.x = originalSize.x / 1000}
    		if (originalSize.y != null) {size.y = originalSize.y / 1000}
	    }
  	  if (this.useUnitScale) {		//scales the image so that its longest side is exactly one unit
  	    let longestSide = Math.max(size.x, size.y);
        size.x = size.x / longestSide;
        size.y = size.y / longestSide;
  	  }
      let geometry = new THREE.PlaneGeometry(size.x, size.y);
      this.value = new THREE.Mesh(geometry, this.material);
      this.object3D.add(this.value);
    }
  }
  get size() {return this._size}
  get opacity() {return this.material.opacity} set opacity(inValue) {this.material.opacity = inValue}
  get side() {return this.material.side} set side(inValue) {this.material.side = inValue}
  get map() {return this._map} set map(inValue) {this._map = inValue; this.material.map = inValue.value}
  get envMap() {return this._envMap} set envMap(inValue) {this._envMap = inValue; this.material.envMap = inValue.value}
  get color() {return this._color} set color(inValue) {this._color = inValue; this.material.color = new THREE.Color(this._color).convertSRGBToLinear()}
  static get definition() {return {name:'ImageMesh', type:bc.CLASS, childMap:{
	  color:{type:bc.INTEGER, mod:bc.FIELD, default:0xffffff},
	  side:{type:bc.INTEGER, mod:bc.FIELD, default:2},
	  transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:true},
	  originalSize:{type:'_Vector', mod:bc.FIELD},
//	  absoluteSize:{type:'_Vector', mod:bc.FIELD},
	  useUnitScale:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
	  map:{type:bc.CONTROL, mod:bc.FIELD},
    envMap:{type:bc.CONTROL, mod:bc.FIELD},
	  opacity:{type:bc.FLOAT, mod:bc.FIELD, default:1}}}}
}
bc.ControlFactory.newFactory(bc.control.ImageMesh);
bc.control.Mesh = class extends bc.control.Control3D {
  _geometry = null; _material = null; _mesh = null;
  get material() {return this._material}
  set material(inDetail) {
    this._material = inDetail;
    if (this._mesh) {
      let material = this._material.ref.value;
      let geometry = this._geometry.ref.value;
      if (geometry instanceof THREE.Mesh || geometry instanceof THREE.Group) {
        this.assignMat(this._mesh, material);
      } else {this._mesh.material = material}
      material.needsUpdate = true;
    }
  }
  get geometry() {return this._geometry}
  set geometry(inDetail) {
    this._geometry = inDetail;
    if (this._mesh) this.object3D.remove(this._mesh);
    let material = null;
    if (!this._material) material = new THREE.MeshBasicMaterial({opacity:0, visible:false});
    else material = this._material.value;
    let geometry = this._geometry.ref.value;
    if (geometry instanceof THREE.Mesh || geometry instanceof THREE.Group) {
      this._mesh = this.cloneMesh(geometry);
      this.assignMat(this._mesh, material);
    } else {this._mesh = new THREE.Mesh(geometry, material)}
    this.object3D.add(this._mesh);
    let renderOrder = this.object3D.renderOrder;
    this.object3D.traverse((child)=>{child.renderOrder = renderOrder})
  }
  get renderOrder() {return this.object3D.renderOrder}
  set renderOrder(inValue) {this.object3D.renderOrder = inValue}
  doUpdateAction(inDetail) {this.geometry = this._geometry}
  remove() {
    if (this._material) this.removeChild(this._material);
    if (this._geometry) this.removeChild(this._geometry);
    this._material = null;
    this._geometry = null;
    super.remove();
  }
  static get definition() {return {name:'Mesh', type:bc.CLASS, childMap:{
    renderOrder:{type:bc.INTEGER, mod:bc.FIELD, default:0, description:'Set render order of all children'},
    geometry:{type:bc.GEOMETRY, mod:bc.FIELD, description:'geometry of the object'},
    material:{type:bc.MATERIAL, mod:bc.FIELD, description:'material of the object'},
    doUpdate:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Update mesh if geometry changed'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Mesh);
bc.control.Server = class extends bc.control.Control {
  typeListenerMap = {};
  uuidMap = {};
  uuid = 0;
  queue = [];
  async init(inDesign) {
    this.value = this.socket = io.connect();
    bc.socket = this;

    const queue = [];
    this.socket.on('response', (inMessage)=>{
      this.queueMessage(async ()=>{
        let uuid = inMessage.uuid;
        let listener = this.uuidMap[uuid];
        if (listener) {
          delete this.uuidMap[uuid];
          listener(inMessage);
        }
      });
    });
    this.socket.on('resourceAnchorRequest', (inMessage)=>{
      // Handle a user entering the environment.  Wait until major events are done then Send the design.
      let env = this.world.childMap[inMessage.anchorId];
      let envDesign = this.world.toStringFromDetail(env, bc.FULL_DESIGN);
      inMessage.anchorDocument = envDesign;
      this.socket.emit('response', {uuid:inMessage.uuid, userId:inMessage.userId, anchorId:inMessage.anchorId, anchorDocument:envDesign});
    });
    this.socket.on('directRequest', (inMessage)=>{this.notifyListeners(inMessage.type, inMessage)});
    this.socket.on('direct', (inMessage)=>{this.notifyListeners(inMessage.type, inMessage)});
    this.socket.on('broadcast', (inMessage)=>{
      this.queueMessage(async ()=>{await this.notifyListeners(inMessage.type, inMessage)});
    });
    this.socket.on('addAnchorUser', (inMessage)=>{this.notifyListeners('addAnchorUser', inMessage)});
    this.socket.on('removeAnchorUser', (inMessage)=>{this.notifyListeners('removeAnchorUser', inMessage)});
    let response = await this.server.serverRequest({type:'newUserRequest', message:{}});
    console.log('message:', response);
    this.userId = response.userId;
  }
  async queueMessage(inCallback) {
    this.queue.push(inCallback);
    if (this.queue.length > 1) return;
    while (this.queue.length > 0) {
      const callback = this.queue[0];
      await callback();
      this.queue.shift();
    }
  }
  // Send a message directly to a user.
  direct(toUserId, type, inDesign) {
    inDesign.fromUserId = this.userId;
    inDesign.toUserId = toUserId;
    inDesign.type = type;
    this.socket.emit('direct', inDesign);
  }
  // Send a message directly to a user and wait for a response
  directRequest(toUserId, type, inDesign) {
    return new Promise((resolve, reject)=>{
      let uuid = inDesign.uuid = this.uuid++;
//      let timeOut = setTimeout(()=>{reject({error:'directRequest timeout', toUserId:toUserId, type:type, inDesign:inDesign})}, 3000);

      inDesign.fromUserId = this.userId;
      inDesign.toUserId = toUserId;
      inDesign.userId = toUserId;
      inDesign.type = type;
      this.uuidMap[uuid] = (response)=>{resolve(response)}
      this.socket.emit('directRequest', inDesign);
    })
  }
  // Send a response back to a request
  directResponse(inMessage, outMessage) {
    outMessage.uuid = inMessage.uuid;
    outMessage.toUserId = inMessage.fromUserId;
    outMessage.userId = inMessage.fromUserId;
    outMessage.fromUserId = inMessage.toUserId;
    outMessage.type = inMessage.type;
    this.socket.emit('response', outMessage);
  }
  broadcast(inType, inAnchorId, inMessage) {
    inMessage.fromUserId = this.userId;
    inMessage.anchorId = inAnchorId;
    inMessage.type = inType;
    this.socket.emit('broadcast', inMessage);
  }
  serverRequest(inDesign) {
    return new Promise((resolve, reject)=>{
      this.queueMessage(async ()=>{
        let uuid = inDesign.message.uuid = this.uuid++;
        this.uuidMap[uuid] = (response)=>{resolve(response)}
        this.socket.emit(inDesign.type, inDesign.message);
      });
    })
  }
/*  sendRequest(inDesign) {
    this.socket.emit('externalRequest', inDesign);
  } */
  static get definition() {return {name:'Server', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.Server);
// A special control that is a place holder for a control
// that some other control is waiting to reference before it's created.
bc.control.Anchor = class extends bc.control.Control {
  waitListeners = [];
  waitForFinish() {
    return new Promise((resolve, reject)=>{
      let timeOut = setTimeout(()=>{reject({cause:'Anchor timeout', anchor:this.localId})}, debugDelay-100);
      this.waitListeners.push((inControl)=>{
        clearTimeout(timeOut);
        resolve(inControl)});
    });
  }
  transferControl(inControl) {
    for (let cI = 0, cLen = this.waitListeners.length; cI < cLen; cI++) {this.waitListeners[cI](inControl)}
    this.waitListeners = null;
  }
  static get definition() {return {name:'Anchor', type:bc.CLASS, childMap:{}, description:'Used internally by the script to represent control place holder.'}}
}
bc.ControlFactory.newFactory(bc.control.Anchor);
bc.control.PerspectiveCamera = class extends bc.control.Control3D {
  constructor(inParent, inDesign) {
    super(inParent, inDesign);
    this.object3D = bc.world.agent.camera;
  }
  remove() {
    this.object3D = null;
    super.remove();
  }
  static get definition() {return {name:'PerspectiveCamera', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.PerspectiveCamera);
bc.control.AngleUtil = class extends bc.control.Control {
  get x() {return this.parent.current.object3D.rotation.x}
  get y() {
    let rot = this.parent.current.object3D.rotation;
    rot.reorder('YXZ');
    let y = rot.y;
    rot.reorder('XYZ');
    return y;
  }
  get z() {
    let rot = this.parent.current.object3D.rotation;
    rot.reorder('ZYX');
    let z = rot.z;
    rot.reorder('XYZ');
    return z;
  }
  static get definition() {return {name:'AngleUtil', type:bc.CLASS, childMap:{
    x:{type:bc.FLOAT, mod:bc.TRAIT, description:'rotation angle x'},
    y:{type:bc.FLOAT, mod:bc.TRAIT, description:'rotation angle y'},
    z:{type:bc.FLOAT, mod:bc.TRAIT, description:'rotation angle z'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.AngleUtil);
bc.control.Measure3D = class extends bc.control.Control {
  get boxMin() {
    let box = this.value.ref.geometryBox;
    if (box) return {x:box.min.x, y:box.min.y, z:box.min.z}
    else return {x:0, y:0, z:0}
  }
  get size() { // TRAIT
    let box = this.geometryBox;
    let minX = box.min.x, minY = box.min.y, minZ = box.min.z, maxX = box.max.x, maxY = box.max.y, maxZ = box.max.z;
console.log('minY:', minY, ' maxY:', maxY);
    let childMap = this.childMap;
    for (let key in childMap) {
      let child = childMap[key];
      if (child instanceof bc.control.Control3D) {
        let size = child.size;
        let p = child.object3D.position;
        minX = Math.min (minX, p.x - size.x / 2);
        minY = Math.min (minY, p.y - size.y / 2);
        minZ = Math.min (minZ, p.z - size.z / 2);
        maxX = Math.max (maxX, p.x + size.x / 2);
        maxY = Math.max (maxY, p.y + size.y / 2);
        maxZ = Math.max (maxZ, p.z + size.z / 2);
console.log('child:', child.localId, ' p.y:', p.y, ' minY:', minY, ' maxY:', maxY);
      }
    }
    let s = this.object3D.scale;
console.log('this:', this.localId, ' Size.Y:', (maxY - minY)*s.y, ' s.y:', s.y);
    let size = new THREE.Vector3((maxX - minX)*s.x, (maxY - minY)*s.y, (maxZ - minZ)*s.z);
    return size;
  }
  get boxMax() {
    let box = this.value.ref.geometryBox;
    if (box) return {x:box.max.x, y:box.max.y, z:box.max.z}
    else return {x:0, y:0, z:0}
  }
  static get definition() {return {name:'Measure3D', type:bc.CLASS, childMap:{
    value:{type:'Control3D', mod:bc.FIELD, default:'', description:'Control3D object to measure'},
    size:{type:'_Vector', mod:bc.TRAIT, description:'Size of object. Move this to a util interface.'},
    boxMin:{type:'_Vector', mod:bc.TRAIT, description:'Minimum boxed values'},
    boxMax:{type:'_Vector', mod:bc.TRAIT, description:'Maximum boxed values'},
  }, description:'Pointer'}}
}
bc.ControlFactory.newFactory(bc.control.Measure3D);
bc.control.ScatterLayout = class extends bc.control.Control {
  async doUpdateAction(inDesign, inDetail) {
    const childMap = this.parent.childMap;
    const children = [];
    for (let key in childMap) {let child = childMap[key].ref; if (child instanceof bc.control.Control3D && child.object3D.visible) children.push(child)}
    const locations = [];
    const minDistance = .2;
    for (let cI = 0, cLen = children.length; cI < cLen; cI++) {
      const p1 = children[cI].object3D.position;

      let done = false;
      while (!done) {
        const x1 = p1.x = Math.random() * this.maxX - (this.maxX/2);
        const y1 = p1.y = Math.random() * this.maxY - (this.maxY/2);
        const z1 = p1.z = Math.random() * this.maxZ - (this.maxZ/2);
        let lI = 0;
        const lLen = locations.length;
        let count = 0;
        while (lI < lLen) {
          const p2 = locations[lI++];
          const distance = Math.sqrt(Math.pow(x1 - p2.x, 2) + Math.pow(y1 - p2.y, 2) + Math.pow(z1 - p2.z, 2));
          if (distance < this.minDistance) {console.log('MIN DIST:', distance); break}
          if (count++ >= 1000) {done = true; break;}
        }
        if (lI == lLen) done = true;
      }
      locations.push(p1);
    }
  }
  static get definition() {return {name:'ScatterLayout', type:bc.CLASS, childMap:{
    maxX:{type:bc.FLOAT, mod:bc.FIELD, description:'maximum scatter x'},
    maxY:{type:bc.FLOAT, mod:bc.FIELD, description:'maximum scatter y'},
    maxZ:{type:bc.FLOAT, mod:bc.FIELD, description:'maximum scatter z'},
    minDistance:{type:bc.FLOAT, mod:bc.FIELD, description:'Minimum distance object can be to each other'},
    doUpdate:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Update scatter'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.ScatterLayout);
bc.control.LayoutUtil = class extends bc.control.Control {
  filterAndSort(target) {
    const childMap = target.childMap;
    const children = [];
    for (let key in childMap) {let child = childMap[key].ref; if (child instanceof bc.control.Control3D && child.object3D.visible) children.push(child)}
    children.sort((a,b)=>{
      let aO = a.order, bO = b.order;
      if (aO < bO) return -1;
      else if (aO >= bO) return 1;
      else return 0;
    });
    return children;
  }
  async doVerticalAction(inDesign, inDetail) {
    const target = this.parent.current;
    const children = this.filterAndSort(target);
    let maxSizeY = 0;
    let scaleY = target.object3D.scale.y;
    let sizeYs = new Array(children.length);
    for (let cI = 0, cLen = children.length; cI < cLen; cI++) {
      let child = children[cI];
      let sizeY = child.size.y;
      sizeYs[cI] = sizeY;
      maxSizeY += sizeY;
    }
    let offsetY = maxSizeY / 2;
    for (let cI = 0, cLen = children.length; cI < cLen; cI++) {
      let child = children[cI];
      await child.executeDesign({object:{position:{y:offsetY-sizeYs[cI]/2}}});
      offsetY -= sizeYs[cI];
    }
  }
  async doHorizontalAction(inDesign, inDetail) {
    const target = this.parent.current;
    const children = this.filterAndSort(target).reverse();
    let maxSizeX = 0;
    let scaleX = target.object3D.scale.x;
    let sizeXs = new Array(children.length);
    for (let cI = 0, cLen = children.length; cI < cLen; cI++) {
      let child = children[cI];
      let sizeX = child.size.x;
      sizeXs[cI] = sizeX;
      maxSizeX += sizeX;
    }
    let offsetX = maxSizeX / 2;
    for (let cI = 0, cLen = children.length; cI < cLen; cI++) {
      let child = children[cI];
      await child.executeDesign({object:{position:{x:offsetX-sizeXs[cI]/2}}});
      offsetX -= sizeXs[cI];
    }
  }
  async doRowsAction(inDesign, inDetail) {
    const target = this.parent.current;
    const children = this.filterAndSort(target);
    const scaleX = target.object3D.scale.x;
    const sizeXs = new Array(inDetail).fill(0);
    const scaleY = target.object3D.scale.y;
    const sizeYs = [0];
    let childI = 0;
    let xI = 0;
    let yI = 0;
    let cI = 0;
    let rI = 0;
    while (childI < children.length) {
      let child = children[childI];
      if (cI == inDetail) {cI = 0; rI++; sizeYs.push(0)};
      let sizeX = child.size.x;
      if (sizeX > sizeXs[cI]) sizeXs[cI] = sizeX;
      let sizeY = child.size.y;
      if (sizeY > sizeYs[rI]) sizeYs[rI] = sizeY;
      childI++;
      cI++;
    }
    let maxSizeX = 0;
    for (cI = 0; cI < sizeXs.length; cI++) maxSizeX += sizeXs[cI];
    let maxSizeY = 0;
    for (rI = 0; rI < sizeYs.length; rI++) maxSizeY += sizeYs[rI];
    let offsetX = maxSizeX / 2;
    let offsetY = maxSizeY / 2;
    childI = 0;
    cI = 0;
    rI = 0;
    while (childI < children.length) {
      let child = children[childI];
      if (cI == inDetail) {cI = 0; offsetY -= sizeYs[rI]; rI++; offsetX = maxSizeX / 2}
      await child.executeDesign({object:{position:{x:sizeXs[cI]/2-offsetX, y:offsetY-sizeYs[rI]/2}}});
      offsetX -= sizeXs[cI];
      childI++;
      cI++;
    }
  }
  static get definition() {return {name:'LayoutUtil', type:bc.CLASS, childMap:{
    doHorizontal:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Position children horizontally'},
    doVertical:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'position children vertically'},
    doRows:{type:bc.INTEGER, mod:bc.ACTION, description:'position children in rows of given length'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.LayoutUtil);
bc.control.Group = class extends bc.control.Control3D {
  static get definition() {return {name:'Group', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.Group);
// This factory is used to allow external models to be loaded.
bc.ConceptFactory = class extends bc.ControlFactory {
  static newFactory(inClass) {
    let name = inClass.definition.name;
    if (bc.ControlFactory.factoryOf(name)) console.error ('Factory already exists - ', name);
    let factory = bc.factories[name] = new bc.ConceptFactory(inClass);
  }
  async executeBuild(inKey, inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    let design;
    let modelDesign;
    if (inDesign.model) {
      design = modelDesign = await this.loadModel(inDesign.model);
      this.modifyDesign(design, inDesign);
    }
    else {design = inDesign}
    // Hack - pass in null handler to tell builder to user the object as the handler itself.
    let cInstance = await super.executeBuild(inKey, null, inInstance, design, inPFactory, inPInstance, inPKey);
    // Hack - store original model for difference check when serializing out.
    // The best thing would be to read from the original file instead but it would be slower.
    if (modelDesign) cInstance.value = this.copyDesign(modelDesign);
    if (design.static) {cInstance.staticDesign = this.copyDesign(inDesign)}
    return cInstance;
  }
/*  processDiffRecurse(inADesign, inBDesign) {
    let out = null;
    if (Array.isArray(inADesign)) {
      out = [];
      for (let aI = 0, aLen = inADesign.length; aI < aLen; aI++) {
        if (aI < inBDesign.length) {
          let value = this.processDiffRecurse(inADesign[aI], inBDesign[aI]);
          if (value != null) out.push(value);
        } else out.push(inADesign[aI]);
      }
      if (out.length == 0) out = null;
    }
    else if (typeof inADesign == 'object') {
      out = {};
      for (let key in inADesign) {
        if (inBDesign[key] == null) {out[key] = inADesign[key]}
        else if (inADesign[key] == null) {}
        else {
          let value = this.processDiffRecurse(inADesign[key], inBDesign[key]);
          if (value != null) out[key] = value;
        }
      }
      if (Object.keys(out) == 0) out = null;
    }
    else {
      if (inADesign == null) {out = null}
      else if (inBDesign == null) {out = inADesign}
      else if (inADesign != inBDesign) out = inADesign;
    }
    return out;
  } */
  toDesignFromDetail(inInstance, inMode, inDesign) {
    if (inInstance.static) {return inInstance.staticDesign}
    let nowDesign = this.toDesignFromDetailRecurse(inInstance, inMode, inDesign);
    if (inInstance.model) {
      // This code needs to be debugged to only return the differences in the model
      // To bypass the bug we just remove the model reference and return the entire model.
//      let testDesign = this.toDesignFromDetailRecurse(inInstance, inMode, inInstance.value);
      let testDesign = this.toDesignFromDetailRecurse(inInstance, inMode, {});
      delete testDesign.model;
      return testDesign;
    }
    else {
      return nowDesign;
    }
  }
}
bc.control.Concept = class extends bc.control.Control3D {
  access = null;
  get concept() {return this};
  static get definition() {return {name:'Concept', type:bc.CLASS, childMap:{
    static:{type:bc.BOOLEAN, mod:bc.FIELD, default:false, description:'Ignore changes in concept when serializing'},
    access:{type:bc.STRING, mod:bc.FIELD, description:'comma seperated user access list.  keyword user means current user'},
    lockId:{type:bc.STRING, mod:bc.FIELD, volatile:true, description:'Who has the lock on this concept'},
    model:{type:bc.STRING, mod:bc.FIELD, order:1, description:'url to model used for this concept'},
  }}}
}
bc.ConceptFactory.newFactory(bc.control.Concept);
// This factory is used to allow external models to be loaded.
bc.ExternalFactory = class extends bc.ControlFactory {
  static newFactory(inClass) {
    let name = inClass.definition.name;
    if (bc.ControlFactory.factoryOf(name)) console.error ('Factory already exists - ', name);
    let factory = bc.factories[name] = new bc.ExternalFactory(inClass);
  }

  async executeBuild(inKey, inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    let modelDesign;
    if (!inDesign.url) {console.error('url needed in ', inDesign); debugger;}
    let design = modelDesign = await this.loadModel(inDesign.url);
    const modify = inDesign.modify ? inDesign.modify : {};
    this.modifyDesign(design, modify);
    design.id = inKey;

    let cFactory = bc.ControlFactory.factoryOf(design.type);

    // Hack - pass in null handler to tell builder to user the object as the handler itself.
    let cInstance = await cFactory.executeBuild(inKey, null, inInstance, design, inPFactory, inPInstance, inPKey);

    // Hack - store original model for difference check when serializing out.
    // The best thing would be to read from the original file instead but it would be slower.
    if (modelDesign) cInstance.value = this.copyDesign(modelDesign);
    if (design.static) {cInstance.staticDesign = this.copyDesign(inDesign)}
    return cInstance;
  }
  toDesignFromDetail(inInstance, inMode, inDesign) {
    debugger;
    if (inInstance.static) {return inInstance.staticDesign}
    let nowDesign = this.toDesignFromDetailRecurse(inInstance, inMode, inDesign);
    if (inInstance.url) {
      // This code needs to be debugged to only return the differences in the model
      // To bypass the bug we just remove the model reference and return the entire model.
//      let testDesign = this.toDesignFromDetailRecurse(inInstance, inMode, inInstance.value);
      let testDesign = this.toDesignFromDetailRecurse(inInstance, inMode, {});
      delete testDesign.model;
      return testDesign;
    }
    else {
      return nowDesign;
    }
  }
}
bc.control.External = class extends bc.control.Control3D {
  access = null;
  get concept() {return this};
  static get definition() {return {name:'External', type:bc.CLASS, childMap:{
    modify:{type:bc.DATA, mod:bc.FIELD, description:'design changes to do to the external design before execution'},
    url:{type:bc.STRING, mod:bc.FIELD, order:1, description:'url to model used for this concept'},
  }}}
}
bc.ExternalFactory.newFactory(bc.control.External);
bc.control.Area = class extends bc.control.Control3D {
  get area() {return this};
  static get definition() {return {name:'Area', type:bc.CLASS, childMap:{}, description:'A Group the represents an area of objects.'}}
}
bc.ControlFactory.newFactory(bc.control.Area);
// Deprecated
/*bc.control.Plaque = class extends bc.control.Control3D {
  // Hopefully one day we can make this generic.  What really needs to
  // happen is that Plaque uses cells to adjust things.
  static get definition() {return {name:'Plaque', type:bc.CLASS, description:'DEPRECATED', childMap:{
    cellGap:{type:bc.FLOAT, mod:bc.FIELD, default:0, description:'Y Gap between objects'}}}}
}
bc.ControlFactory.newFactory(bc.control.Plaque); */
bc.control.SpriteMesh = class extends bc.control.Control3D {
  init(inDesign) {
    if (inDesign.map) {
      let parms = Object.assign({}, {color:this.color, blending:THREE.AdditiveBlending, depthTest:false, opacity:.15, dithering:true, transparent:true});
      parms.map = this.map.value;
      let material = new THREE.SpriteMaterial(parms);
      this.value = new THREE.Sprite(material);
      this.object3D.add(this.value);
    }
  }
  static get definition() {return {name:'SpriteMesh', type:bc.CLASS, childMap:{
    map:{type:bc.CONTROL, mod:bc.FIELD},
    color:{type:bc.INTEGER, mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(bc.control.SpriteMesh);
bc.control.DirectionalLight = class extends bc.control.Control3D {
  init(inDesign) {
    const light = this.value = new THREE.DirectionalLight(this.color, this.intensity);
    if (this.object3D.castShadow) {
      light.castShadow = true;
      light.shadow.camera.top = 2;
      light.shadow.camera.bottom = - 2;
      light.shadow.camera.right = 2;
      light.shadow.camera.left = - 2;
      light.shadow.mapSize.set( 4096, 4096 );
    }
    this.object3D.add(light);
  }
  update(inDesign) {this.object3D.remove(this.value); this.init(inDesign)}
  static get definition() {return {name:'DirectionalLight', type:bc.CLASS, childMap:{
    color:{type:bc.INTEGER, mod:bc.FIELD},
    intensity:{type:bc.FLOAT, mod:bc.FIELD}}}}
};
bc.ControlFactory.newFactory(bc.control.DirectionalLight);
bc.control.PointLight = class extends bc.control.Control3D {
  color = 0xffffff; intensity = 1; distance = 0; decay = 1;
  init(inDesign) {
    this.value = new THREE.PointLight(this.color, this.intensity, this.distance, this.decay);
    this.object3D.add(this.value);
  }
  update(inDesign) {this.object3D.remove(this.value); this.init(inDesign)}
  static get definition() {return {name:'PointLight', type:bc.CLASS, childMap:{
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0xffffff},
    intensity:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    distance:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    decay:{type:bc.FLOAT, mod:bc.FIELD, default:1}}}}
}
bc.ControlFactory.newFactory(bc.control.PointLight);
bc.control.HemisphereLight = class extends bc.control.Control3D {
  skycolor = 0xffffff; groundColor = 0xffffff; intensity = 1;
  init(inDesign) {
    this.value = new THREE.HemisphereLight(this.skycolor, this.groundColor, this.intensity);
    this.object3D.add(this.value);
  }
  update(inDesign) {this.object3D.remove(this.value); this.init(inDesign)}
  static get definition() {return {name:'HemisphereLight', type:bc.CLASS, childMap:{
    skycolor:{type:bc.INTEGER, mod:bc.FIELD, default:0xffffff},
    groundColor:{type:bc.INTEGER, mod:bc.FIELD, default:0xffffff},
    intensity:{type:bc.FLOAT, mod:bc.FIELD, default:1}}}}
}
bc.ControlFactory.newFactory(bc.control.HemisphereLight);
bc.control.ExternalString = class extends bc.control.Control {
  async init(inDesign) {
    if (inDesign.url) {this.value = await this.loadString(inDesign.url)}
  }
  loadString(inUrl) {
    return new Promise((resolve, reject)=>{
      let xmlRequest = new XMLHttpRequest();
      xmlRequest.open('GET', '/'+inUrl);
      xmlRequest.responseType = 'text';
      xmlRequest.onload = ()=>{
        if(xmlRequest.response == '') {reject({error:'Bad Response', response:xmlRequest.response})}
        resolve(xmlRequest.response);
      }
      xmlRequest.send();
    })
  }
  doAppendAction(inDesign, inDetail) {
    this.value = this.value.concat(inDetail);
  }
  static get definition() {return {name:'ExternalString', type:bc.CLASS, childMap:{
    url:{type:bc.STRING, mod:bc.FIELD, description:'optionally load string from a Url'},
    value:{type:bc.STRING, mod:bc.TRAIT, description:'String value'}}}}
}
bc.ControlFactory.newFactory(bc.control.ExternalString);
bc.control.String = class extends bc.control.Control {
  doAppendAction(inDesign, inDetail) {
    this.value = this.value.concat(inDetail);
  }
  static get definition() {return {name:'String', type:bc.CLASS, childMap:{
    doAppend:{type:bc.STRING, mod:bc.ACTION},
    value:{type:bc.STRING, mod:bc.FIELD, description:'String value'}}}}
}
bc.ControlFactory.newFactory(bc.control.String);
bc.control.Float = class extends bc.control.Control {
  static get definition() {return {name:'Float', type:bc.CLASS, childMap:{
    value:{type:bc.FLOAT, mod:bc.FIELD, description:'Float value'}}}}
}
bc.ControlFactory.newFactory(bc.control.Float);
bc.control.Integer = class extends bc.control.Control {
  get asMoney() {
    return this.value.toFixed(2);
  }
  static get definition() {return {name:'Integer', type:bc.CLASS, childMap:{
    value:{type:bc.INTEGER, mod:bc.FIELD, description:'Integer value'},
    asMoney:{type:bc.STRING, mod:bc.TRAIT, description:'Round to 2 decimals'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.Integer);
bc.control.Vector = class extends bc.control.Control {
  x = 0; y = 0; z = 0;
  static get definition() {return {name:'Vector', type:bc.CLASS, childMap:{
    x:{type:bc.FLOAT, mod:bc.FIELD, default:0}, y:{type:bc.FLOAT, mod:bc.FIELD, default:0}, z:{type:bc.FLOAT, mod:bc.FIELD, default:0}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Vector);
bc.control.Euler = class extends bc.control.Control {
  x = 0; y = 0; z = 0; order = "XYZ";
  static get definition() {return {name:'Euler', type:bc.CLASS, childMap:{
    x:{type:bc.FLOAT, mod:bc.FIELD, default:0}, y:{type:bc.FLOAT, mod:bc.FIELD, default:0}, z:{type:bc.FLOAT, mod:bc.FIELD, default:0},
    order:{type:bc.STRING, mod:bc.FIELD, default:'XYZ'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Euler);
bc.control.Boolean = class extends bc.control.Control {
  value = false;
  static get definition() {return {name:'Boolean', type:bc.CLASS, childMap:{
    value:{type:bc.BOOLEAN, mod:bc.FIELD, default:false, description:'Boolean value'}}}}
}
bc.ControlFactory.newFactory(bc.control.Boolean);
bc.control.Copy = class extends bc.control.Control {
  static get definition() {return {name:'Copy', type:bc.CLASS, childMap:{
  }, description:'Copy'}}
}
bc.CopyFactory = class extends bc.ControlFactory {
  constructor() {super(bc.control.Copy)}
  async executeBuild(inKey, inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    let handler = inHandler ? inHandler : inInstance;

    if (typeof inDesign._value == 'string') inDesign = bc.world.compileString(inDesign._value);  // Deprecated
    else inDesign = inDesign._value;

    let detail = await handler.factory.evaluate(handler, inDesign);
    let copyInstance = detail.ref;
    let cDesign = copyInstance.toDesignFromDetail(bc.FULL_DESIGN, null);
    cDesign.id = inKey;
    let cFactory = copyInstance.factory;
    await cFactory.executeBuild(inKey, inHandler, inInstance, cDesign, inPFactory, inPInstance, inPKey);
  }
},
bc.ControlFactory.addFactory(new bc.CopyFactory());
bc.control.Pointer = class extends bc.control.Control {
  value = '';
  get ref() {if (this.value != '') return this.value.ref; else return ''}
  static get definition() {return {name:'Pointer', type:bc.CLASS, childMap:{
    value:{type:bc.CONTROL, mod:bc.FIELD, default:'', description:'Pointer value'}
  }, description:'Pointer'}}
}
bc.PointerFactory = class extends bc.ControlFactory {
  constructor() {super(bc.control.Pointer)}
  async executeDesignRecurse(inHandler, inInstance, inDesign, inPFactory, inPInstance, inPKey) {
    // If setting the pointer value then handle evaulation of the path.
    if (inDesign.value) {
      let value = inDesign.value;
      if (typeof value == 'string') {value = bc.world.compileString(value) }  // Hack - Deprecated
      let handler = inHandler ? inHandler : inInstance;
      let result = await handler.factory.evaluate(handler, value, this, inInstance, inInstance);
      inInstance.value = result;
    }
    else {await inInstance.ref.factory.executeDesignRecurse(inHandler, inInstance.ref, inDesign, inPFactory, inPInstance, inPKey)}
  }
},
bc.ControlFactory.addFactory(new bc.PointerFactory());
bc.control.Iterator = class extends bc.control.Control {
  get hasNext() {}
  get hasPrevious() {}
  async doNextAction() {this.index = this.index < this.max ? this.index + 1 : this.min}
  async doPreviousAction() {this.index = this.index > this.min ? this.index - 1 : this.max}
  doResetAction() {}
  get doIterate() {return bc.ControlFactory.newInstance('DoIterate', this, {id:name, type:'DoIterate'})}
  // Iterate an array by bui1lding a loop control to handle te looping.  Remove it after execution.
  async doIterateAction(inDesign, inDetail, inHandler) {
    let count = 0, name;
    inDetail.parent = inHandler;
    let iterator = this;
    let rules = inDetail.onNext;
    if (rules && rules.length > 0) {
      iterator.doResetAction();
      while (iterator.hasNext) {
        inDetail.current = await iterator.doNextAction();
        await inDetail.executeRules(rules);
      }
    }
  }
  static get definition() {return {name:'Iterator', type:bc.CLASS, childMap:{
    current:{type:bc.CONTROL, mod:bc.TRAIT, description:'current item pointed to by iterator'},
    loop:{type:bc.BOOLEAN, mod:bc.FIELD, description:'Loop around iterator if at either end of iteration'},
    hasNext:{type:bc.BOOLEAN, mod:bc.TRAIT, description:'return true if iterator has a next item'},
    hasPrevious:{type:bc.BOOLEAN, mod:bc.TRAIT, description:'return true if iterator has a previous item'},
    doNext:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'set the iterator to the next item'},
    doPrevious:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'set the iterator to the previous item'},
    doReset:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'reset iterator to minimum'},
    min:{type:bc.INTEGER, mod:bc.FIELD, description:'the minimum value of the iterator index if one is allowed'},
    doIterate:{type:'DoIterate', mod:bc.ACTION, description:'Iterate over a given array'},
    max:{type:bc.INTEGER, mod:bc.FIELD, description:'the maximum value of the iterator index if one is allowed'},
    index:{type:bc.INTEGER, mod:bc.FIELD, description:'the index now of the iterator'}}}}
}
bc.ControlFactory.newFactory(bc.control.Iterator);
bc.control.VisibleChildIterator = class extends bc.control.Iterator {
  filterAndSort(target) {
    const childMap = target.childMap;
    const children = [];
    for (let key in childMap) {let child = childMap[key]; if (child instanceof bc.control.Control3D && child.object3D.visible) children.push(child)}
    children.sort((a,b)=>{
      let aO = a.order, bO = b.order;
      if (aO < bO) return -1;
      else if (aO >= bO) return 1;
      else return 0;
    });
    return children;
  }
  get hasNext() {
    if (this.index+1 < this.list.length) return true;
    return false;
  }
  async doNextAction() {
    this.index++;
    return this.list[this.index];
  }
  doResetAction () {
    this.list = this.filterAndSort(this.parent);
    this.index = -1;
  }
  static get definition() {return {name:'VisibleChildIterator', type:bc.CLASS, childMap:{}, description:'Iterator for only visible children'}}
}
bc.ControlFactory.newFactory(bc.control.VisibleChildIterator);
bc.control.TypeChildIterator = class extends bc.control.Iterator {
  filterAndSort(target) {
    const childMap = target.childMap;
    const children = [];
    for (let key in childMap) {
      const child = childMap[key].ref;
      if (child.handler && child.handler.ref === this.filter.ref) children.push(child)
    }
    children.sort((a,b)=>{
      let aO = a.order, bO = b.order;
      if (aO < bO) return -1;
      else if (aO >= bO) return 1;
      else return 0;
    });
    return children;
  }
  get hasNext() {if (this.index+1 < this.list.length) return true; return false}
  get hasPrevious() {if (this.index-1 >= 0) return true; return false}
  async doNextAction() {
    if (this.hasNext) {this.index++}
    else if (this.loop) {this.index = 0}
    return this.list[this.index];
  }
  async doPreviousAction() {
    if (this.hasPrevious) {this.index--}
    else if (this.loop) {this.index = this.list.length-1}
    return this.list[this.index];
  }
  doResetAction () {
    this.list = this.filterAndSort(this.parent);
    this.index = -1;
  }
  static get definition() {return {name:'TypeChildIterator', type:bc.CLASS, childMap:{
    filter:{type:bc.CONTROL, mod:bc.FIELD, description:'path to concept type wanted'}
  }, description:'Iterator for a type of child'}}
}
bc.ControlFactory.newFactory(bc.control.TypeChildIterator);
bc.control.Measure = class extends bc.control.Control {
  scalar = 1;
  set source(inDetail) {this.measure()}
  get source() {return this.source}
  set target(inDetail) {this.measure()}
  get target() {return this.target}
  measure() {
    let source = this.source;
    let target = this.target;
    if (source && target) {
      let sourceWorld = new THREE.Vector3();
      source.object3D.localToWorld(sourceWorld);
      let targetWorld = new THREE.Vector3();
      target.object3D.localToWorld(targetWorld);
      this.diffWorld = new THREE.Vector3();
      this.diffWorld.copy(sourceWorld);
      this.diffWorld.sub(targetWorld)
      this.diffWorld.multiplyScalar(this.scalar);
    }
  }
  get distance() {
    let diff = this.diffWorld;
    return {x:Math.abs(diff.x), y:Math.abs(diff.y), z:Math.abs(diff.z)}
  }
  static get definition() {return {name:'Measure', type:bc.CLASS, childMap:{
    scalar:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    source:{type:bc.CONTROL, mod:bc.FIELD},
    target:{type:bc.CONTROL, mod:bc.FIELD},
    distance:{type:'_Vector', mod:bc.TRAIT}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Measure);
bc.control.Note = class extends bc.control.Control {
  static get definition() {return {name:'Note', type:bc.CLASS, childMap:{
    text:{type:bc.STRING, mod:bc.FIELD, description:'Text associated with the note'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.Note);
bc.control.Action = class extends bc.control.Control {
  get current() {return this._current}
  set current(inDetail) {this._current = inDetail}
  async doAction(inDesign, inDetail, inHandler) {
    this.current = inHandler.current;
    this.avatar = this.identity;
    this.user = this.identity; // Legacy
    await this.factory.executeDesignRecurse(inHandler, this, inDesign, null, null, null);
    await this.executeRules(this.onAction);
  }
  async doTellAllAction(inDesign, inDetail, inHandler) {
    let resolvedDesign = await this.resolveDesign(inHandler, inDetail);
    if (this.env.userCount > 1) {
      this.server.broadcast('ExecuteAction', this.env.id, {userId:this.server.userId, actionId:this.localId, rules:resolvedDesign})
    }
  }
  async doTellAction(inDesign, inDetail, inHandler) {
    let resolvedDesign = await this.resolveDesign(inHandler, inDetail);
console.log('doTellAction - id:', this.id, ' toId:', resolvedDesign.toId, ' fromUserId:', resolvedDesign.fromId, ' resolvedDesign:', resolvedDesign);
    this.server.direct(resolvedDesign.toId, 'ExecuteAction', {userId:this.server.userId, actionId:this.localId, rules:resolvedDesign});
  }
  static get definition() {return {name:'Action', type:bc.CLASS, childMap:{
    avatar:{type:bc.CONTROL, mod:bc.TRAIT, description:'user avatar who invoked the action'},
    user:{type:bc.CONTROL, mod:bc.TRAIT, description:'DEPRECATED - user who invoked the action'},
    userId:{type:bc.STRING, mod:bc.TRAIT, description:'DEPRECATED - user id of executing user'},
    doTellAll:{type:bc.RULES, mod:bc.ACTION, description:'Tell all users the given rules'},
    doTell:{type:bc.RULES, mod:bc.ACTION, description:'Tell a user the given rules'},
    onAction:{type:bc.RULES, mod:bc.FIELD, description:'Called when design is updated'},
    do:{type:bc.RULES, mod:bc.ACTION, description:'Execute Action'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.Action);
bc.control.EnvironmentCompleteAction = class extends bc.control.Action {
  init() {
    this.env.addListener(bc.ENVIRONMENT_COMPLETE_EVENT, async (inDesign)=>{
      this.userId = this.server.userId;
      await this.executeRules(this.onAction);
    });
  }
  static get definition() {return {name:'EnvironmentCompleteAction', type:bc.CLASS, childMap:{
  }}}
}
bc.ControlFactory.newFactory(bc.control.EnvironmentCompleteAction);
bc.control.AddControllerAction = class extends bc.control.Action {
  init() {
    this.env.addListener(bc.ADD_CONTROLLER_EVENT, async (inDesign)=>{
      this.user = this.identity;
      this.name = inDesign.name;
      await this.executeRules(this.onAction);
    });
  }
  static get definition() {return {name:'AddControllerAction', type:bc.CLASS, childMap:{
    name:{type:bc.STRING, mod:bc.TRAIT, description:'Name of controller being added'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.AddControllerAction);
bc.control.UserAction = class extends bc.control.Action {
  init() {
    this.env.addListener(bc.ADD_USER_EVENT, async (inDesign)=>{
      this.targetUserId = inDesign.newUserId;
      this.userId = this.server.userId;
      await this.executeRules(this.onAdd);
    });
    this.env.addListener(bc.REMOVE_USER_EVENT, async (inDesign)=>{
      this.targetUserId = inDesign.removeUserId;
      this.userId = this.server.userId;
      await this.executeRules(this.onRemove);
    })
  }
  static get definition() {return {name:'UserAction', type:bc.CLASS, childMap:{
    targetUserId:{type:bc.STRING, mod:bc.TRAIT, description:'id of user being targeted'},
    onAdd:{type:bc.RULES, mod:bc.FIELD, description:'Called when user is added'},
    onRemove:{type:bc.RULES, mod:bc.FIELD, description:'Called when user is removed'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.UserAction);
bc.control.KeyboardListener = class extends bc.control.Action {
  init() {
    this.env.addListener(bc.KEYBOARD_EVENT, async (inDesign)=>{
      this.avatar = this.identity;
      this.mode = inDesign.mode;
      this.key = inDesign.key;
      this.sendMimic({mode:inDesign.mode, key:inDesign.key});
      await this.executeRules(this.onAction);
    });
  }
  sendMimic(inMessage) {
    let control = this;
    let access = null;
    while (control != null) {
      if (control.access) {access = control.access; break;}
      control = control.parent }
    if (!access || access == 'public') {
      inMessage.actionId = this.localId;
      inMessage.controllerId = bc.world.agent.controllerMap['Keyboard'].profile.name;
      this.env.userBroadcast('UpdateController', bc.world.activeEnv.id, inMessage); }
    else {
      // console.log('sendMimic - no access for ', this.localId)
    }
  }
  async mimicController(c) {
    this.mode = c.message.mode;
    this.key = c.message.key;
    this.avatar = this.env.userMap[c.message.fromUserId];
    await this.executeRules(this.onAction);
  }
  static get definition() {return {name:'KeyboardListener', type:bc.CLASS, childMap:{
    access:{type:bc.STRING, mod:bc.FIELD, description:'comma seperated user access list.  keyword user means current user'},
    key:{type:bc.STRING, mod:bc.FIELD, description:'string value of key pressed'},
    mode:{type:bc.STRING, mod:bc.FIELD, description:'key mode 0 is up 1 is down 2 is pressed'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.KeyboardListener);
bc.control.IntersectAction = class extends bc.control.Action {
  oldLocation = {position:new THREE.Vector3(), rotation:new THREE.Vector3()};
  position = new THREE.Vector3();
  rotation = new THREE.Vector3();
  point = new THREE.Vector3();
  uv = new THREE.Vector3();
  normal = new THREE.Vector3();
  speed = {position:new THREE.Vector3(), rotation:new THREE.Vector3()};
  angle = 0;
  normal = new THREE.Vector3();
  uprightNrm = new THREE.Vector3( 0, 1, 0 );
  controller = null;
  access = null;
  init() {
    let control = this;
    while (control && !control.access) {control = control.parent}
    if (control) this.access = control.access;
    this.parent.setIntersectable();
    this.parent.addListener(bc.INTERSECT_EVENT, async (inDetail)=>{
      await this.handleController(inDetail.controller, inDetail.state);
    });
  }
  async mimicController(c) {
    let action = c.action;
    this.avatar = this.env.userMap[c.message.fromUserId];
    this.current = c.control;
    if (c.message.point) this.updateVector(this.point, c.message.point);
    if (c.message.uv) this.updateVector(this.uv, c.message.uv);
    if (c.message.speed) this.speed = c.message.speed;
    if (c.actionMode == 'onFocused') {await action.executeRules(this.onFocused)}
    else if (c.actionMode == 'onUnfocused') {await action.executeRules(this.onUnfocused)}
    else if (c.actionMode == 'onIntersected') {await action.executeRules(this.onIntersected)}
    else if (c.actionMode == 'onSelected') {await action.executeRules(this.onSelected)}
    else if (c.actionMode == 'onUnselected') {await action.executeRules(this.onUnselected)}
    else if (c.actionMode == 'onGrabbed') {await action.executeRules(this.onGrabbed)}
    this.current = null;
  }
  updateVector(inSource, inTarget) {inSource.x = inTarget.x; inSource.y = inTarget.y; inSource.z = inTarget.z}
  sendMimic(inMessage) {
    if (!this[inMessage.actionMode]) return; // Ignore actions with no rules
    // If this is not a private IntersectAction i.e. this.access = 'private'
    if (!this.access) {
      inMessage.actionId = this.localId;
if (!this.controller) console.error('controller null inMessage:', inMessage);
      inMessage.controllerId = this.controller.profile.name;
      inMessage.controlId = this.current.localId;
      this.env.userBroadcast('UpdateController', bc.world.activeEnv.id, inMessage);
    }
  }
  async lock() {
    let found = true;
    let userId = this.identity.id;
    if (!this.access && this.userLock != userId) {
      const response = await this.server.serverRequest({type:'lockAnchorRequest', message:{anchorId:this.fullId}});
      this.userLock = response.userId;
      if (response.userId != userId) found = false;
    }
    return found;
  }
  async unlock() {
    let userId = this.identity.id;
    if (!this.access) {
      let response = await this.server.serverRequest({type:'unlockAnchorRequest', message:{anchorId:this.fullId}});
      this.userLock = null;
    }
  }
  async handleController(controller, state) {
    if (await this.lock() == false) return;  // If lock denied then return
    this.controller = controller;
    const control = controller.control;
//    if (!(c === this.controller) && this.controller != null) return;
    let intersection = controller.intersection;
    if (!controller.isActive || controller.ignore) {return}
    if (intersection) {
      controller.scaleLine = intersection.distance;
      this.updateVector(this.point, intersection.point);
      if (intersection.uv) {this.updateVector(this.uv, intersection.uv)}
      if (intersection.face) {
        this.updateVector(this.normal, intersection.face.normal);
        this.angle = THREE.Math.RAD2DEG * this.uprightNrm.angleTo(this.normal);
      }
    }
    this.updateVector(this.position, controller.storePosition);
    this.updateVector(this.rotation, controller.storeRotation);
    this.avatar = this.identity;
    // Hack - if controller is null then a control is being disconnected from this action so unfocus it.
    if (state == 'unfocus') {
      if (this.current) {
        this.sendMimic({actionMode:'onUnfocused', x:100, y:100});
        await this.executeRules(this.onUnfocused);
        controller.touched = false;
        this.current = null;
        this.unlock();
      }
      return;
    }
    if (!this.current) {
      this.current = control;
//console.log('c:', c);
      this.sendMimic({actionMode:'onFocused', x:100, y:100});
      await this.executeRules(this.onFocused);
    }
    // If the object we are focused on is null then is was deleted so make sure to reset the controller and return
    if (this.current.parent == null) {
      this.current = null; controller.isLocked = false; return
    }
/*    if (control != this.current) {
      this.sendMimic({actionMode:'onUnfocused', x:100, y:100});
      await this.executeRules(this.onUnfocused);
      controller.touched = false;
      this.current = null;
      this.unlock();
      return;
    }*/
    if (this.onTouched) {
      if (this.controller && this.controller.intersection && this.controller.intersection.distance < .2 && !controller.touched) {
        controller.touched = true;
        this.sendMimic({actionMode:'onTouched', x:100, y:100});
        await this.executeRules(this.onTouched);
      }
    }
    if (controller.buttonStateMap['Select'].pressed && !controller.isLocked) {
      controller.isLocked = true;
      this.oldLocation.position.copy(this.position);
      this.oldLocation.rotation.copy(this.rotation);
      this.sendMimic({actionMode:'onSelected', point:this.point, uv:this.uv});
      await this.executeRules(this.onSelected);
    }
    if (!controller.buttonStateMap['Select'].pressed && controller.isLocked) {
      controller.isLocked = false;
      this.sendMimic({actionMode:'onUnselected', point:this.point, uv:this.uv});
      await this.executeRules(this.onUnselected);
    }
    if (this.onIntersected && control == this.current) {
      this.sendMimic({actionMode:'onIntersected', point:this.point, uv:this.uv});
      await this.executeRules(this.onIntersected);
    }
    if (this.onGrabbed && controller.isLocked) {
      let sp = this.oldLocation.position;
      let sr = this.oldLocation.rotation;
      let tp = this.position;
      let tr = this.rotation;
      this.speed = {position:{x:(tp.x - sp.x), y:(tp.y - sp.y), z:(tp.z - sp.z)}, rotation:{x:(tr.x - sr.x), y:(tr.y - sr.y), z:(tr.z - sr.z)}};
      this.oldLocation.position.copy(this.position);
      this.oldLocation.rotation.copy(this.rotation);

      this.sendMimic({actionMode:'onGrabbed', speed:this.speed});
      await this.executeRules(this.onGrabbed);
    }
  }
  remove() {
    this.unlock();
    super.remove();
  }
  async doUnfocusAction() {
    if (this.current) {
      console.warn('Doing Unfocus');
      this.sendMimic({actionMode:'onUnfocused', x:100, y:100});
      await this.executeRules(this.onUnfocused);
      this.current = null;
      this.unlock();
    }
  }
  get plane() {
    let normal = this.normal;
    let nrmRtY = Math.atan(normal.x/normal.z) + (normal.z < 0 ? 3.1415 : 0.0);
    let nrmRtX = Math.atan((Math.sqrt(normal.x * normal.x + normal.z * normal.z)) / normal.y );
    let e = new THREE.Euler(nrmRtX, nrmRtY, 0, 'YXZ');
    return {x:e.x, y:e.y, z:e.z};
  }
  static get definition() {return {name:'IntersectAction', type:bc.CLASS, childMap:{
    angle:{type:bc.FLOAT, mod:bc.TRAIT},
    mode:{type:bc.STRING, mod:bc.FIELD},
    normal:{type:'_Vector', mod:bc.FIELD},
    position:{type:'_Vector', mod:bc.FIELD},
    rotation:{type:'_Vector', mod:bc.FIELD},
    point:{type:'_Vector', mod:bc.FIELD},
    uv:{type:'_Vector', mod:bc.FIELD},
    plane:{type:'_Vector', mod:bc.TRAIT},
    speed:{type:'_Location', mod:bc.TRAIT},
    doUnfocus:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Force unfocus of current object to avoid when current focus is deleted.'},
    onFocused:{type:bc.RULES, mod:bc.FIELD, description:'Focused'},
    onUnfocused:{type:bc.RULES, mod:bc.FIELD, description:'Unfocused'},
    onSelected:{type:bc.RULES, mod:bc.FIELD, description:'Selected'},
    onUnselected:{type:bc.RULES, mod:bc.FIELD, description:'Unselected'},
    onGrabbed:{type:bc.RULES, mod:bc.FIELD, description:'Grabbed'},
    onIntersected:{type:bc.RULES, mod:bc.FIELD, description:'Intersected'},
    onTouched:{type:bc.RULES, mod:bc.FIELD, description:'Intersected'},
  }}}
};
bc.ControlFactory.newFactory(bc.control.IntersectAction);
bc.control.Handler = class extends bc.control.Action {
  uid = 0;
  clients = [];
  intersectable = false;
  setIntersectable() {
    for (let cI = 0, cLen = this.clients.length; cI < cLen; cI++) this.env.addIntersectable(this.clients[cI]);
    this.intersectable = true
  }
  addClient(inControl) {
    if (this.intersectable) this.env.addIntersectable(inControl);
    let clients = this.clients;
    for (let cI = 0, cLen = clients.length; cI < cLen; cI++) {if (inControl === clients[cI]) return}
    this.clients.push(inControl)
  }
  removeClient(inControl) {
    // Notify listeners with a null controller to remove any actions happening.
    inControl.notifyListeners(bc.INTERSECT_EVENT, {controller:this, state:'unfocus'});
    if (this.intersectable) this.env.removeIntersectable(inControl);
    let clients = this.clients;
    for (let cI = 0, cLen = clients.length; cI < cLen; cI++) {if (inControl === clients[cI]) {clients.splice(cI, 1); break}}
  }
  async doBroadcastAction(inDesign, inDetail, inHandler) {
    await this.factory.executeDesignRecurse(inHandler, this, inDesign, null, null, null);
    await this.executeRules(this.onBroadcast);
    let clients = this.clients;
    for (let cI = 0, cLen = clients.length; cI < cLen; cI++) {
      let client = clients[cI];
      client.current = this;
      await client.executeRules(client.onAction);
    }
  }
  doSetCurrentAction(inDesign, inDetail) {this.current = inDetail}
  async doBuildAction(inDesign, inDetail, inHandler) {
    let design = {};
    let resolvedDesign = await this.resolveDesign(inHandler, inDetail);
    let id = resolvedDesign.id;
//    if (!id) id = this.id+'_'+this.uid++; // Create a unique id if one is not given.
    // Set target location of new client to parent.  If parent is a Handler then user it's current value.
    let target = this.parent;
    if (target instanceof bc.control.Handler) {target = this.parent.current}
    if (!id) {
      let childMap = target.childMap;
      id = this.id;
      let i = 0;
      while (childMap[id+i]) {i++}
      id = id + i;
    }

    // Use design property as design of new client.
    this.design != null ? design[id] = this.factory.copyDesign(this.design) : design[id] = {};
    design[id].id = id;
    const factory = bc.ControlFactory.factoryOf(design[id].type);
    // Modify the design based on input design.
    factory.modifyDesign(design[id], resolvedDesign);
    design[id].handler = [this.localId];
    // Execute design where the built child is going but use the current collection as the inHandler point.
    this.current = target;
    await target.factory.executeDesignRecurse(this, target, design, null, null, null);
    this.current = target.childMap[id];
    await this.executeRules(this.onBuild);
  }
  remove() {
    let clients = this.clients;
    while (clients.length) {clients[0].removeHandler()}
    super.remove();
  }
  static get definition() {return {name:'Handler', type:bc.CLASS, childMap:{
    clients:{type:bc.ARRAY, mod:bc.TRAIT, description:'DEPRECATED - Array of all clients'},
    design:{type:bc.RULES, mod:bc.FIELD, description:'Design of items in collection'},
    doSetCurrent:{type:bc.CONTROL, mod:bc.ACTION, description:'Set the current property'},
    doBroadcast:{type:bc.RULES, mod:bc.ACTION, description:'Call onAction in all actons associated to this handler'},
    onBroadcast:{type:bc.RULES, mod:bc.FIELD, description:'Called before a broadcast is done'},
    onBuild:{type:bc.RULES, mod:bc.FIELD, description:'Called after a child is built'},
    doBuild:{type:bc.DATA, mod:bc.ACTION, description:'Build a new Child from design'},
    onUnbuild:{type:bc.RULES, mod:bc.FIELD, description:'Called when a child is unbuilt'},
    onUpdate:{type:bc.RULES, mod:bc.FIELD, description:'Called when a item in the collection is updated'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.Handler);
bc.control.ControllerAction = class extends bc.control.Action {
  selectState = 0; buttonAState = 0; buttonBState = 0; axisX = 0; axisY = 0;
  init() {
    this.env.addListener(bc.CONTROLLER_EVENT, async (inDesign)=>{
      this.avatar = this.identity;
      await this.factory.executeDesignRecurse(this, this, inDesign, null, null, null);
      await this.executeRules(this.onAction);
    });
  }
  static get definition() {return {name:'ControllerAction', type:bc.CLASS, childMap:{
    selectState:{type:bc.INTEGER, mod:bc.FIELD, description:'select state'},
    buttonAState:{type:bc.INTEGER, mod:bc.FIELD, description:'select state'},
    buttonBState:{type:bc.INTEGER, mod:bc.FIELD, description:'select state'},
    axisX:{type:bc.FLOAT, mod:bc.FIELD, description:'axisX'},
    axisY:{type:bc.FLOAT, mod:bc.FIELD, description:'axisY'}
  }}}
}
bc.ControlFactory.newFactory(bc.control.ControllerAction);
// DEPRECATED - Use Handler instead.
bc.control.Collection = class extends bc.control.Handler {
  static get definition() {return {name:'Collection', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.Collection);
bc.control.ClientIterator = class extends bc.control.Iterator {
  get hasNext() {
    if (this.index+1 < this.parent.clients.length) return true;
    return false;
  }
  async doNextAction() {
    this.parent._current = this.parent.clients[++this.index];
    return this.parent._current;
  }
  doResetAction () {this.index = -1}
  static get definition() {return {name:'ClientIterator', type:bc.CLASS, childMap:{
    value:{type:'Handler', mod:bc.FIELD, description:'The handler to iterate'}
  }, description:'Iterate handler clients'}}
}
bc.ControlFactory.newFactory(bc.control.ClientIterator);
// DEPRECATED - use ClientIterator.
bc.control.CollectionIterator = class extends bc.control.ClientIterator {
  static get definition() {return {name:'CollectionIterator', type:bc.CLASS, childMap:{}, description:'DEPRECATED'}}
}
bc.ControlFactory.newFactory(bc.control.CollectionIterator);

// Simulate multiple inheritance by combining Control3D with Handler
bc.control.PortalAction = class extends bc.control.Action {
  async doPortAction(inDesign, inDetail) {
    let envId = this.sceneName;
    let worldId = this.world.instanceId;
    let localId = envId+'-'+worldId;
    let fullId = '_world.'+localId;
    if (this.world.childMap[localId]) {
      console.error ('PortalAction.doPort - environment ', fullId, ' already exists');
    } else {
      let maxCount = 0;
      let counter = 0;
      this.world.loadEnvironment(envId, worldId).then((newEnv)=>{this.world.switchEnvironment(newEnv)});
      this.percent = 0;
      let max = 0;
      let status;
      do {
        status = await this.world.statusWait();
        max = status > max ? status : max;
        if (status != 0) this.percent = status / max;
        else this.percent = 0;
        await this.executeRules(this.onStatusUpdate);
      } while (status > 0);
    }
  }
  static get definition() {return {name:'PortalAction', type:bc.CLASS, childMap:{
    doPort:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Port to sceneName with worldId'},
    sceneName:{type:bc.STRING, mod:bc.FIELD, description:'name of environment to port too'},
    percent:{type:bc.FLOAT, mod:bc.FIELD, description:'Percentage of environment loaded'},
    onStatusUpdate:{type:bc.RULES, mod:bc.FIELD, description:'called when status changes'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.PortalAction);
bc.control.Effect = class extends bc.control.Control {
  isPlaying = false; loop = false;
  processCount = 0;
  processMap = {};
  process = null;
  finishListener = [];
  get processor() {return this}
  newProcess(inDetail) {
    let process = new bc.Process(inDetail);
    this.processMap[process.id] = process;
    this.processCount++;
    this.isPlaying = true;
    // Register with parent processor if one is needed to run local processes.
    if (this.process == null) {this.doProcessPromise()}
    return process;
  }
  async doProcessPromise() {
    // Listen to tick from parent processor and pass to all local processes.
    let process = this.parent.processor.newProcess({name:'Effect'});
    while (this.processCount) {
      let now = await process.tickWait();
      if (!this.isPlaying) {now = bc.FINISH}
      for (let key in this.processMap) {
        let process = this.processMap[key];
        if (process.onCallback) {process.onCallback(now)}
      }
    }
    for (let lI = 0; lI < this.finishListener.length; lI++) {
      this.finishListener[lI]();
    }
    this.finishListener.length = 0;
    this.parent.processor.removeProcess(process);
    this.process = null;
  }
  removeProcess(process) {
    if (process.onComplete) {process.onComplete()}
    delete this.processMap[process.id];
    this.processCount--;
  }
  async doPlayAction(inDesign, inDetail) {this.doPlayPromise()}
  async doPlayPromise() {
    if (!this.isPlaying) {
      this.isPlaying = true;
      do {
        await this.executeRules(this.onPlay);
        await this.doWaitSyncAction(null, null);
      }
      while (this.loop && this.isPlaying);
      this.isPlaying = false;
    }
  }
  doWaitSyncAction() {
    return new Promise((resolve, reject)=>{
      if (this.processCount > 0) {
        this.finishListener.push(()=>{resolve()});
      }
      else {resolve()}
    })
  }
  async doStopAction(inDesign, inDetail) {
    await this.executeRules(this.onStop);
    this.isPlaying = false;
    // Wait for processes to die before exiting.
    await this.doWaitSyncAction();
  }
  async doPauseAction(inDesign, inDetail) {}
  get doAnimate() {
    let count = 0, name;
    do {name = 'doAnimate'+count++} while (this.childMap[name]);
    let instance = bc.ControlFactory.newInstance('DoAnimate', this, {id:name, type:'DoAnimate'});
    this.childMap[name] = instance;
    return instance;
  }
  async doAnimateAction(inDesign, inDetail, inHandler) {
    let result = null;
    if (inDetail.value) {result = await inHandler.factory.toValueFromPath(inHandler, inDetail.value.split('.'))}
    inDetail.current = inHandler.current;
    this.doAnimatePromise(inDetail, result);
  }
  async doAnimatePromise(inDetail, inRef) {
    let process = this.newProcess({name:'doAnimate'});
    let current = this.current;
    let ease = inDetail.ease ? inDetail.ease : 0;
    let fromTime = inDetail.fromTime ? inDetail.fromTime : 0;
    let toTime = inDetail.toTime ? inDetail.toTime : fromTime;
    let to = inDetail.to ? inDetail.to : 0;
    let from = inDetail.from ? inDetail.from : 0;
    let startFrame = Math.floor(fromTime / 16.6666);
    let endFrame = Math.floor(toTime / 16.6666);
    let distance = to - from;
    let duration = toTime - fromTime;
    let value = 0;
    let isBusy = false;
    let now = Date.now();
    fromTime += now; toTime += now;
    while (now != toTime) {
      now = await process.tickWait();
      if (now == bc.FINISH) break;
      if (now > toTime) now = toTime;
      if (now >= fromTime) {
        let t = duration ? 1 - (toTime - now) / duration : 1;
        if (ease == 0) {value = distance * t + from}
        else if (ease == 1) {value = distance * t * t + from} // easeInQuad
        else if (ease == 2) {value = distance * t * t * t + from}  // easeInCubic
        else if (ease == 3) {value = distance * (t * (2 - t)) + from}  // easeOutQuad
        else if (ease == 4) {value = distance * ((t - 1) * (t - 1) * (t - 1) + 1) + from} // easeOutCubic
        else if (ease == 5) {value = distance * (t < .5 ? 2*t*t : -1+(4-2*t)*t) + from} // easeInOutQuad
        else if (ease == 6) {value = distance * (t < .5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1) + from} // easeInOutCubic
        if (inRef) inRef[0].setField(inRef[1], inRef[2], value);
        inDetail.now = value;
        if (inDetail.onTick) {await inDetail.executeRules(inDetail.onTick)}
      }
    }
    if (now != bc.FINISH) {
      inDetail.now = inDetail.to;
      if (inDetail.onTick) {await inDetail.executeRules(inDetail.onTick)}
      if (inDetail.onTime) {await inDetail.executeRules(inDetail.onTime)}
    }
    this.removeProcess(process);
    inDetail.remove();
  }
  static get definition() {return {name:'Effect', type:bc.CLASS, childMap:{
    doPlay:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Tell the animation handler to play'},
    doPause:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Tell the animation handler to pause'},
    doStop:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Tell the animation handler to stop'},
    doAnimate:{type:'DoAnimate', mod:bc.ACTION},
    doWaitSync:{type:bc.TYPE_EMPTY, mod:bc.ACTION, description:'Wait for handler to finish events'},
    loop:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    isPlaying:{type:bc.BOOLEAN, mod:bc.TRAIT},
    onPlay:{type:bc.RULES, mod:bc.FIELD},
    onStop:{type:bc.RULES, mod:bc.FIELD, description:'Rules for when animation is told to stop'},
  }}}
}
bc.ControlFactory.newFactory(bc.control.Effect);
bc.control.Self = class extends bc.control.Control3D {
  init(inDesign) {bc.world.agent.user = this}
  static get definition() {return {name:'Self', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(bc.control.Self);
bc.control.GlowEffect = class extends bc.control.Control {
  frameNow = 0; frameDirection = 1; toTime = 1200; startOpacity = .5; endOpacity = 1; startColor = 0x000000; endColor = 0xFFFFFF; speed = 2000;
  init(inDesign) {this.glowPromise()}
  async glowPromise() {
    this.toTime = this.speed;
    this.endFrame = this.toTime/16.666;
    this.startRed = (this.startColor>>16)/0xff;
    this.startGreen = ((this.startColor>>8)&0xff)/0xff;
    this.startBlue = (this.startColor&0xff)/0xff;
    this.endRed = (this.endColor>>16)/0xff;
    this.endGreen = ((this.endColor>>8)&0xff)/0xff;
    this.endBlue = (this.endColor&0xff)/0xff;
    this.shiftRed = (this.endRed-this.startRed)/this.endFrame;
    this.shiftGreen = (this.endGreen-this.startGreen)/this.endFrame;
    this.shiftBlue = (this.endBlue-this.startBlue)/this.endFrame;
    this.shiftOpacity = (this.endOpacity-this.startOpacity)/this.endFrame;
    this.process = this.processor.newProcess({name:'GlowEffect'});
    let now = Date.now();
    let control = this.parent;
    do {
      let material = control.material.value;
      material.color.r = this.startRed + this.shiftRed*this.frameNow;
      material.color.g = this.startGreen + this.shiftGreen*this.frameNow;
      material.color.b = this.startBlue + this.shiftBlue*this.frameNow;
      material.transparent = true;
      material.opacity = this.startOpacity + this.shiftOpacity*this.frameNow;
      material.needsUpdate = true;
      this.frameNow += this.frameDirection;
      if (this.frameNow < 0) {
        this.frameNow = 0;
        this.frameDirection = 1;
      }
      if (this.frameNow >= this.endFrame) {
        this.frameNow = this.endFrame - 1;
        this.frameDirection = -1;
      }
      now = await this.process.tickWait();
    } while (now > 0);
    this.processor.removeProcess(this.process);
  }
  static get definition() {return {name:'GlowEffect', type:bc.CLASS, childMap:{
    frameNow:{type:bc.INTEGER, mod:bc.FIELD, default:0},
    frameDirection:{type:bc.INTEGER, mod:bc.FIELD, default:1},
    toTime:{type:bc.INTEGER, mod:bc.FIELD, default:1200},
    startOpacity:{type:bc.FLOAT, mod:bc.FIELD, default:.5},
    endOpacity:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    startColor:{type:bc.INTEGER, mod:bc.FIELD, default:0x000000},
    endColor:{type:bc.INTEGER, mod:bc.FIELD, default:0xFFFFFF},
    speed:{type:bc.INTEGER, mod:bc.FIELD, default:2000}
  }}}
};
bc.ControlFactory.newFactory(bc.control.GlowEffect);
export {bc};
