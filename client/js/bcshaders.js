

import {bc} from "/js/docXR.js";
import * as THREE from 'three';

class AnimatedMaterial extends bc.control.Material {
  async doPlayPromise(inMod, inMult) {
    if (inMod == null) inMod = 12000;
    if (inMult == null) inMult = 1;
    this.process = this.processor.newProcess({name:'AnimatedMaterial'});
    let now = Date.now();
    let startTime = now;
    do {
      let elapsedMilliseconds = now - startTime;
      this.uniforms.timeMsec.value = (elapsedMilliseconds * inMult) % inMod;
      now = await this.process.tickWait();
    } while (now > 0);
    this.processor.removeProcess(this.process);
  }
  remove() {
    if (this.process) this.processor.removeProcess(this.process);
    super.remove();
  }
  static get definition() {return {name:'AnimatedMaterial', type:bc.CLASS, childMap:{}}}
}
bc.ControlFactory.newFactory(AnimatedMaterial);
bc.PrimeTilingFactory = class extends bc.PrimeControlFactory {
  constructor() {super(bc.PrimeTilingFactory)}
  static get definition() {return {name:'_Tiling', type:bc.CLASS, childMap:{
  	u:{type:bc.FLOAT, mod:bc.FIELD, default:10},
  	v:{type:bc.FLOAT, mod:bc.FIELD, default:10},
  }}}
}
bc.ControlFactory.addFactory(new bc.PrimeTilingFactory());






//Basic material. Copy this to get started on anything new
class SampleMaterial extends AnimatedMaterial {
  //todo: make the vec3 for origin behave more like other vec3s throughout the code - so that it's specified like {x:123, y:123, z:123} in html
  alpha = 1.0; baseColor = 0xffffff;
  worldRadius = 10;
  transparent = false;
  origin = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0});
  vectorParam = {u:1, v:1};
  flowSpeed = 1;
  strength = 0.1;

  init(inDesign) {
			//prepare argument data for the shader
		this.uniforms = {
			alpha: { value: Number(this.alpha) },
			baseColor: { value: new THREE.Color(this.baseColor) },
			colorMap: { value: this.colorMap.value },
			floatParam: { value: this.floatParam },
			timeMsec: { value: 0 },
			vectorParam: { value: new THREE.Vector2(this.vectorParam.u, this.vectorParam.v ) },
		};

		//instantiate shader proper in Three.JS
		this.value = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: SampleMaterial.vertexShader,
			fragmentShader: SampleMaterial.fragmentShader
		});

		//Iterate a timer for any animated effects	(mmmmmmmmight be nice if all shaders could share a timer... but it doesn't need to be a priority any time soon)
		Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
    this.doPlayPromise(12000);
  }
  static get vertexShader() {return `
		varying vec2 vUv;
		varying vec4 worldCoord;

		void main() {
			//initialize these so they get passed to frag shader
			vUv = uv;

			//bring the new vertex position into gl coordinate space (in view frustum, I believe?)
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`}
  static get fragmentShader() {return `
		uniform vec3 baseColor;
		varying vec2 vUv;
		uniform float timeMsec;
		uniform sampler2D colorMap;

		void main() {
			//sample texture
			vec4 texColor = texture2D(colorMap, vUv);

			//multiply texture color by model color
			gl_FragColor = vec4( texColor.rgb * baseColor.rgb, 1.0 * texColor.a );

		}`}
  static get definition() {return {name:'SampleMaterial', type:bc.CLASS, childMap:{
  	baseColor:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	colorMap:{type:bc.CONTROL, mod:bc.FIELD},
  	transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    floatParam:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
  	vectorParam:{type:'_Tiling', mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(SampleMaterial);







//My goal for this material: refract the environment map so the screens appear to be a window into another space. Maybe some visual effects on top of that.
//	The correct approach here may be to extend basicmaterial and just change the envmap's mapping mode.
//	BUT that will change the envmap's mapping mode scene-wide... maybe it makes more sense to make the shader break the rules and
//		refract the envmap no matter what? To avoid duplicating the texture in memory.
//
//	Here I was in my brain thinking "oh but we won't be using the envmaps anywhere else in the scene so it's okay to flip them"
//		Yes we are, they're literally there to be applied to the store objects. stupid.
//
//	So making the shader break the rules is for sure the way to go
//
//
// Why don't normal maps work? Because it's not based on MeshStandard, genius
class ShowroomScreensMaterial extends bc.control.MeshBasicMaterial {

	isCompiled = false;

  init(inDesign) {
		this.value.onBeforeCompile = (shader) => {
			shader.uniforms.timeMsec = { value: 0};

			// shader.vertexShader = 'varying vec3 vWorldPosition;\nuniform float timeMsec;\n' + shader.vertexShader;
			// shader.vertexShader = shader.vertexShader.replace(
				// '#include <begin_vertex>',
				// SkyDeckRiverMaterial.vertexRipple
			// );

			shader.vertexShader = 'uniform float timeMsec;\n#define USE_UV\n' + shader.vertexShader;
			shader.vertexShader = shader.vertexShader.replace(	//force refraction regardless of texture settings; can switch this to invert in the future maybe? but I don't see a reason right now
				'#include <envmap_vertex>',
				ShowroomScreensMaterial.refractify
			);

			shader.fragmentShader = 'uniform float timeMsec;\n#define USE_UV\n' + shader.fragmentShader;
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <dithering_fragment>',
	//			'gl_FragColor += vUv.y * timeMsec;'

				'gl_FragColor = (gl_FragColor + sin((vUv.y * 1200.0) - timeMsec * 0.01) * 0.02) * 1.1 - 0.1;'

				//sin((worldCoord.y * 40.0) - time * 4.0);

			);

	//		console.log("Trying to find shader: ");
	//		console.log(shader);

      this.doPlayPromise(shader);
		};
		this.isCompiled = true;
  }


	//Add animation timer
  async doPlayPromise(shader) {
    this.process = this.processor.newProcess({name:'AnimatedMaterial'});
    let now = Date.now();
    let startTime = now;
    do {
      let elapsedMilliseconds = now - startTime;
      shader.uniforms.timeMsec.value = elapsedMilliseconds % 12000;
      now = await this.process.tickWait();
    } while (now > 0);
    this.processor.removeProcess(this.process);
  }

	static get refractify() {return `
		#ifdef USE_ENVMAP

			#ifdef ENV_WORLDPOS

				vWorldPosition = worldPosition.xyz;

			#else

				vec3 cameraToVertex;

				if ( isOrthographic ) {

					cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );

				} else {

					cameraToVertex = normalize( worldPosition.xyz - cameraPosition );

				}

				vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );

				#ifdef ENVMAP_MODE_REFLECTION

			//		vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
					vReflect = refract( cameraToVertex, worldNormal, 0.95 );

				#else

					vReflect = refract( cameraToVertex, worldNormal, refractionRatio );

				#endif

			#endif

		#endif
	`}

  static get definition() {return {name:'ShowroomScreensMaterial', type:bc.CLASS, childMap:{
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
  }}}
}
bc.ControlFactory.newFactory(ShowroomScreensMaterial);







//Basic material. Copy this to get started on anything new
class UserBarShimmerMaterial extends AnimatedMaterial {
  //todo: make the vec3 for origin behave more like other vec3s throughout the code - so that it's specified like {x:123, y:123, z:123} in html
  alpha = 1.0; baseColor = 0xffffff;
  worldRadius = 10;
  transparent = false;
  origin = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0});
  vectorParam = {u:1, v:1};
  flowSpeed = 1;
  strength = 0.1;

  init(inDesign) {
		//prepare argument data for the shader
		this.uniforms = {
			alpha: { value: Number(this.alpha) },
			baseColor: { value: new THREE.Color(this.baseColor) },
			colorMap: { value: this.colorMap.value },
			floatParam: { value: this.floatParam },
			timeMsec: { value: 0 },
			vectorParam: { value: new THREE.Vector2(this.vectorParam.u, this.vectorParam.v ) },
		};

		//instantiate shader proper in Three.JS
		this.value = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: UserBarShimmerMaterial.vertexShader,
			fragmentShader: UserBarShimmerMaterial.fragmentShader
		});

		//Iterate a timer for any animated effects	(mmmmmmmmight be nice if all shaders could share a timer... but it doesn't need to be a priority any time soon)
		Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
    this.doPlayPromise(12000);
  }
  static get vertexShader() {return `
		varying vec2 vUv;
		varying vec4 worldCoord;

		void main() {
			//initialize these so they get passed to frag shader
			vUv = uv;

			//bring the new vertex position into gl coordinate space (in view frustum, I believe?)
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`}
  static get fragmentShader() {return `
		uniform vec3 baseColor;
		varying vec2 vUv;
		uniform float timeMsec;
		uniform sampler2D colorMap;

		void main() {
			//sample texture

			vec4 texColor = texture2D(colorMap, vUv + vec2(timeMsec / 6000.0, 0.0));

			//multiply texture color by model color
			gl_FragColor = vec4( texColor.rgb * baseColor.rgb, 1.0 * texColor.a );

		}`}
  static get definition() {return {name:'UserBarShimmerMaterial', type:bc.CLASS, childMap:{
  	baseColor:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	colorMap:{type:bc.CONTROL, mod:bc.FIELD},
  	transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    floatParam:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
  	vectorParam:{type:'_Tiling', mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(UserBarShimmerMaterial);








//Shader for skydeck riverbed
class UnderwaterMaterial extends AnimatedMaterial {
  //todo: make the vec3 for origin behave more like other vec3s throughout the code - so that it's specified like {x:123, y:123, z:123} in html
  alpha = 1.0; baseColor = 0xffffff;
  worldRadius = 10;
  transparent = false;
  origin = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0});
  tiling = {u:1, v:1};
  normTiling = {u:1, v:8};
  flowSpeed = 1;
  strength = 0.1;

  init(inDesign) {
		this.uniforms = {
			alpha: { value: Number(this.alpha) },
			colorMap: { value: this.colorMap.value },
			normalMap: { value: this.normalMap.value },
			baseColor: { value: new THREE.Color(this.baseColor) },
			tiling: { value: new THREE.Vector2(this.tiling.u, this.tiling.v ) },
			normTiling: { value: new THREE.Vector2(this.normTiling.u, this.normTiling.v ) },
			worldRadius: { value:Number(this.worldRadius)},
			origin: { value: this.origin },
			flowSpeed: { value: this.flowSpeed },
			strength: { value: this.strength },
			timeMsec: { value: 0 },
		};
		this.value = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: UnderwaterMaterial.vertexShader,
			fragmentShader: UnderwaterMaterial.fragmentShader
		});
		Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
    this.doPlayPromise(12000);
  }
  static get vertexShader() {return `
    uniform vec2 tiling; // Repeats the texture over the surface of the mesh. Use for e.g. bricks, etc
    uniform float worldRadius; // Determines the distance from origin at which to start fading the scene.

	uniform vec3 origin; //A point in 3D space, even though we only use the X and Z coordinates.

    varying vec2 vUv;
	//varying float dist; // A vertex's distance from the passed-in origin

	varying vec4 worldCoord;

    void main() {

      //initialize these so they get passed to frag shader
      vUv = uv * tiling;

	  //Calculate distance from a Y-axis emanating from the supplied origin.
	  //	For now, only cylinder masks are supported.
      worldCoord = vec4(position, 1.0) * modelMatrix;
	  worldCoord = modelMatrix * vec4(position, 1.0);

      //bring the new vertex position into gl coordinate space (in view frustum, I believe?)
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`}
  static get fragmentShader() {return `
    uniform vec3 baseColor;

	uniform vec2 normTiling;

    uniform float worldRadius;
	uniform float strength;

    varying vec2 vUv;
	//varying float dist;

	uniform vec3 origin; //A point in 3D space, even though we only use the X and Z coordinates.

	varying vec4 worldCoord;

	uniform float timeMsec;

    uniform sampler2D colorMap;
    uniform sampler2D normalMap;

	void main() {
		vec4 normColor = (
			texture2D(normalMap, vUv * 0.5 * normTiling + vec2(timeMsec/12000.0, timeMsec / 4000.0)) +
			texture2D(normalMap, vUv * 0.75 * normTiling - vec2(-timeMsec/12000.0, timeMsec / 6000.0))
			) / 2.0;

		vec2 offset = vec2(normColor.r - 0.5, normColor.g - 0.5) * 2.0;

//		offset = vec2(1.0, 1.0);

		//shaping edges	(needs tweaking)
		//damp on X edges
		offset *= 1.0 - smoothstep( 0.3, 0.49, abs(vUv.x - 0.5));
		//damp on Y edges
//		offset *= 1.0 - abs((vUv.y - 0.5) * 2.0 );

		vec4 texColor = texture2D(colorMap, vUv + (offset * vec2(8.0, 1.0) * strength));

		//	  gl_FragColor = vec4(baseColor * texColor.rgb, texColor.a * (1.0 - fade));
		gl_FragColor = vec4(baseColor * texColor.rgb, (1.0));
//		gl_FragColor = vec4(offset.x, offset.y, 0, (1.0));
	}`}
  static get definition() {return {name:'UnderwaterMaterial', type:bc.CLASS, childMap:{
  	alpha:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
  	baseColor:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	tiling:{type:'_Tiling', mod:bc.FIELD},
  	normTiling:{type:'_Tiling', mod:bc.FIELD},
  	worldRadius:{ type:bc.FLOAT, mod:bc.FIELD, default:10},
  	origin:{type:bc.VECTOR, mod:bc.FIELD},
  	colorMap:{type:bc.CONTROL, mod:bc.FIELD},
  	normalMap:{type:bc.CONTROL, mod:bc.FIELD},
  	transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    flowSpeed:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    strength:{type:bc.FLOAT, mod:bc.FIELD, default:0.1},
  }}}
}
bc.ControlFactory.newFactory(UnderwaterMaterial);






//Diorama Shader Experiment
class CloudSpinShaderMaterial extends AnimatedMaterial {
  //todo: make the vec3 for origin behave more like other vec3s throughout the code - so that it's specified like {x:123, y:123, z:123} in html
  alpha = 1.0; color = 0xffffff; time = 0; rpm = 1.0; transparent = false; blendMode = 0; side = 0;
  origin = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0}); tiling = {u:10, v:10};
  init(inDesign) {
		this.startTime = Date.now();
		this.uniforms = {
		  alpha:{value:this.alpha },
		  color:{value:new THREE.Color(this.color) },
		  rpm:{value:this.rpm },
		  origin:{value: this.origin},
      timeMsec: {type: 'time', is: 'uniform'},
		};
		this.value = new THREE.ShaderMaterial({
		  uniforms: this.uniforms,
		  vertexShader: CloudSpinShaderMaterial.vertexShader,
		  fragmentShader: CloudSpinShaderMaterial.fragmentShader
		});

		Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
    this.doPlayPromise(120000000);	//Another shader that isn't built to loop....... I swear it did
  }
  static get vertexShader() {return `
	uniform float timeMsec;
	uniform float rpm;

	uniform vec3 origin; //A point in 3D space, even though we only use the X and Z coordinates.

    varying vec2 vUv;
	//varying float dist; // A vertex's distance from the passed-in origin

	varying vec4 worldCoord;

    void main() {
      //initialize these so they get passed to frag shader
      vUv = uv;

	  worldCoord = modelMatrix * vec4(position, 1.0);


	  //timeMsec divided by one thousand is a seconds
	  //that divided by sixty is a minute
	  //in order to spin that many times, we need to rotate 2pi radians
	  float spin = timeMsec * (vUv.y + 1.0) / 60000.0 * rpm * 6.28318531;

	  //To rotate about Y axis:
	  //x = cos * x + sin * z
	  //z = −sin * x + cos * z
	  //and I'll want to subtract my origin from these points, then add it back in, I think. if not, then the other way around
	  float postSpinX = cos(spin) * (worldCoord.x - origin.x) + sin(spin) * (worldCoord.z - origin.z);
	  float postSpinZ = -1.0 * sin(spin) * (worldCoord.x - origin.x) + cos(spin) * (worldCoord.z - origin.z);

	  worldCoord.x = postSpinX + origin.x; worldCoord.z = postSpinZ + origin.z;

      //bring the new vertex position into gl coordinate space (in view frustum, I believe?)
      gl_Position = projectionMatrix * viewMatrix * worldCoord;
  }`}
  static get fragmentShader() {return `
    uniform vec3 color;

    void main() {
	  //it's just white
	  gl_FragColor = vec4(color, 1.0);
  }`}
  static get definition() {return {name:'CloudSpinShaderMaterial', type:bc.CLASS, childMap:{
  	alpha:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
  	color:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	origin:{type:bc.VECTOR, mod:bc.FIELD},
  	time:{ type:bc.FLOAT, mod:bc.FIELD, default:0.0 },
  	rpm:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
  	transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
  	blendMode:{type:bc.INTEGER, mod:bc.FIELD, default:0},
  	side:{type:bc.INTEGER, mod:bc.FIELD, default:0},
  }}}
}
bc.ControlFactory.newFactory(CloudSpinShaderMaterial);


//Retro Grid Material
//	Eventually: accept the positions of twenty(?) objects and illuminate under them
// Talk to Mike about running that update method
//Also, To-Do:
//	-Configurable scale (meters, feet, etc)
//	-Screen space partial derivative anti aliasing? I think that takes multiple passes so it's not possible
//	-Think about reworking so it uses proper alpha transparency instead of just additive blending
//		(right now it doesn't work well over bright surfaces)
//	-Configurable and maybe even per-object glow radius
//
//	Mike's proposed approach:
//	-If we naively build the positions list from object3d.worldPosition, it's inflexible
//	-If a script user wants to e.g. draw highlights around the curvature of a single model, it wouldn't be able to accommodate that.
//	-A more universal approach:
//		1. The shader takes in a list of positions and radii
//		2. System #1 exists in the environment which programmatically or manually tags objects with 'showOnGrid' or etc
//		3. System #2 exists in the environment which builds an introspective table based on that tag, collates positions
//			and radii however it wants, and then passes that to the shader
//	  This way the grid's behavior can be changed via script, instead of needing changes to the Three.JS side.
//	So the solvable problems for this:
//		-work out the table + the two script systems
//		-plug them in so the table can update in real time
//		-figure out the script/three.js split for performance vs flexibility
//		-how/when to access identity.head (sidestepped if grid doesn't exist until after env initialization?)
class GridShaderMaterial extends bc.control.Material {
  //todo: make the vec3 for origin behave more like other vec3s throughout the code - so that it's specified like {x:123, y:123, z:123} in html
  alpha = 1.0; color = 0xffffff; worldRadius = 10; transparent = false;
  origin = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0}); tiling = {u:10, v:10};
  target0 = null;

  //to-do: set this up as an array
  pos0 = new THREE.Vector2(0, 0);
  pos1 = new THREE.Vector2(0, 0);


  init(inDesign) {
    this.uniforms = {
      color:{value:new THREE.Color(Number(this.color))},
      pos0: { value: this.pos0 },
      pos1: { value: new THREE.Vector2(5, 8) },
      pos2: { value: new THREE.Vector2(0, 0) },
      pos3: { value: new THREE.Vector2(0, 0) },
      pos4: { value: new THREE.Vector2(0, 0) },
      pos5: { value: new THREE.Vector2(0, 0) },
      pos6: { value: new THREE.Vector2(0, 0) },
      pos7: { value: new THREE.Vector2(0, 0) },
      pos8: { value: new THREE.Vector2(0, 0) },
      pos9: { value: new THREE.Vector2(0, 0) },
      pos10: { value: new THREE.Vector2(0, 0) },
      pos11: { value: new THREE.Vector2(0, 0) },
      pos12: { value: new THREE.Vector2(0, 0) },
      pos13: { value: new THREE.Vector2(0, 0) },
      pos14: { value: new THREE.Vector2(0, 0) },
      pos15: { value: new THREE.Vector2(0, 0) },
      pos16: { value: new THREE.Vector2(0, 0) },
      pos17: { value: new THREE.Vector2(0, 0) },
      pos18: { value: new THREE.Vector2(0, 0) },
      pos19: { value: new THREE.Vector2(0, 0) },
      pos20: { value: new THREE.Vector2(0, 0) },
    };
    this.value = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: GridShaderMaterial.vertexShader,
      fragmentShader: GridShaderMaterial.fragmentShader
    });
    Object.assign(this.value, {transparent:this.transparent, blending:this.blendMode, side:THREE.FrontSide, needsUpdate:true});
  }
  update(inDesign) {
    if (this.target0 != null) {
    	if (this.target0.object3D != null) {
    		this.pos0.x = this.target0.object3D.getWorldPosition().x;
    		this.pos0.y = this.target0.object3D.getWorldPosition().z;
    	}
    }
  }
  doBuildAction(inDesign, inDetail) {
    console.log('Building Grid Shader!!', this.table);
    let grid = this.table.ref.grid;
    for (let rI = 0, rLen = grid.length; rI < rLen; rI++) {
      console.log('!!!!!!! Object[',rI,'] = ', grid[rI].map.object3D);
    }
  }
  static get vertexShader() {return `
    //Mask highlighting region around points of interest
	varying float mask;

	//World-space coordinates for each vertex.
	//	Interpolated in the frag shader and used to draw the grid, regardless of how the
	//	shaded mesh might be transformed.
	varying vec3 worldCoord;

    varying vec2 vUv;

	//Point of interest locations, passed in from main program
	uniform vec2 pos0;
	uniform vec2 pos1;
	uniform vec2 pos2;
	uniform vec2 pos3;
	uniform vec2 pos4;
	uniform vec2 pos5;
	uniform vec2 pos6;
	uniform vec2 pos7;
	uniform vec2 pos8;
	uniform vec2 pos9;
	uniform vec2 pos10;
	uniform vec2 pos11;
	uniform vec2 pos12;
	uniform vec2 pos13;
	uniform vec2 pos14;
	uniform vec2 pos15;
	uniform vec2 pos16;
	uniform vec2 pos17;
	uniform vec2 pos18;
	uniform vec2 pos19;
	uniform vec2 pos20;


	//Color passed in from program
    uniform vec3 color;


	//Defines the radius of highlights
	//	radOut is the fuzzy, dark outer edge
	//	radIn is the fully-bright inner circle
	const float radOut = 1.2;
	const float radIn = 0.8;

	void main() {

		//Remember, kids. Matrix multiplication is NOT commutative
		//	do it in exactly this order
		worldCoord = (modelMatrix * vec4(position, 1.0)).xyz;

		//Populate the highlight mask with the location of each POI
		//	would be nice to use a for loop but I wonder about the
		//	overhead of indexing into an array like that
		//This is a good place to try optimizing, since this seems like a naive approach
		mask +=  (smoothstep(6.0, 2.3, distance(worldCoord.xz, pos0)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos1)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos2)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos3)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos4)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos5)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos6)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos7)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos8)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos9)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos10)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos11)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos12)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos13)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos14)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos15)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos16)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos17)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos18)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos19)) );
		mask +=  (smoothstep(radOut, radIn, distance(worldCoord.xz, pos20)) );
		mask = clamp(mask, 0.0, 1.0);


		//Convert grid space from 1 unit = 1 meter
		//	Could do this anywhere, but it's faster in vert
		worldCoord *= 3.048;

		//yadda yadda
		vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * modelViewPosition;
	}
`}
  static get fragmentShader() {return `
	//Could be made more efficent with a bespoke floor mesh - I know I don't need hardly any vertices inside the circle around the camera
	//And maybe we could get away with higher density in the center of vision, if the ground spun around to match the camera.

	//World coordinates passed from vert
	varying vec3 worldCoord;

	//Highlight mask passed from vert
	varying float mask;

	//Color passed in from program...?
    uniform vec3 color;

	void main() {
		//I have no idea at all what 'st' is supposed to stand for
		//	Supposedly it stands for "Coordinate System" which it plainly just doesn't
		//	But we need to use it because we can't modify passed-in variables
		vec2 st = worldCoord.xz;
		float isGrid = 0.0;

		//Set up the grid
		st = fract(st); 		// Wrap around 1.0 so the grid repeats
		st = (st * 2.0) - 1.0; 	//Shift values from (0.0, 1.0) -> (-1.0, 1.0)
		st = abs(st);			//And then take the absolute value
								//Without the shift and abs, the grid would only glow on
								//	one side of each edge

		//Draw grid lines
		//	everything above ~0.9, plus some fuzzy glow
		isGrid = (smoothstep(0.85, 0.95, st.x) +  0.5 * smoothstep(0.6, 1.0, st.x))
				+ (smoothstep(0.85, 0.95, st.y) +  0.5 * smoothstep(0.6, 1.0, st.y));

		//Some other grid algorithms, either cheaper or interesting:

		//	A little cheaper, looks beveled. Too sharp for my taste.
		//isGrid = (smoothstep(0.85, 0.95, max(st.y, st.x)) +  0.5 * smoothstep(0.6, 1.0, max(st.y, st.x)));

		//	Only one smoothstep level per axis. Cheaper, but mushy. Don't like it
		//isGrid = (smoothstep(0.7, 0.97, st.x)) + (smoothstep(0.7, 0.97, st.y));

		//	Beveled AND mushy? No thank you. But if we ever REALLY need the performance, maybe it could be tweaked
		//isGrid = (smoothstep(0.7, 0.97, max(st.y, st.x)));

		//	Diagonal, checkered. Whoops. This isn't to scale but if we ever need checkers, it can be cleaned up
		//isGrid = (smoothstep(0.9, 1.0, clamp(st.y + st.x, 0.0, 1.0)));

		//	Point grid - diamonds
		//isGrid = (smoothstep(0.6, 1.0, clamp(st.y * st.x, 0.0, 1.0)));

		//	Point grid - squares
		//isGrid = (smoothstep(0.85, 0.95, min(st.y, st.x)) +  0.5 * smoothstep(0.6, 1.0, min(st.y, st.x)));


		//	Uncomment this to sharpen the grid. Looks nice, but also does that optical illusion dots thing
		//		Also, it flickers a lot more
//		isGrid *= isGrid;

		//	Cleans up bright spots at edge intersections in highlight fringes.
		//		Looks better, and any compiler worth its salt will convert this to a free instruction
		isGrid = clamp(isGrid, 0.0, 1.0);

		//duh
//		color = vec3(
//				isGrid,
//				isGrid * 0.7,
//				isGrid);


//		color = vec3(1.0, 0.7, 1.0) + (isGrid * mask) / 2.0;

		vec3 newColor = color + (isGrid * mask) / 2.0;

		//Multiply highlights over the grid
		//	Now grid only shows up in highlighted areas
	//	color *= mask * 1.3;
	//	color += mask * isGrid;

		//Output
		gl_FragColor = vec4(clamp(newColor, 0.0, 1.0), (smoothstep(0.0, 0.6, isGrid)) * smoothstep(0.0, 0.6, mask));
//		gl_FragColor = vec4(clamp(newColor, 0.0, 1.0), 1.0);
	}`
}
  static get definition() {return {name:'GridShaderMaterial', type:bc.CLASS, childMap:{
  	alpha:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
  	color:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	tiling:{type:'_Tiling', mod:bc.FIELD},
  	worldRadius:{ type:bc.FLOAT, mod:bc.FIELD, default:10},
  	origin:{type:bc.VECTOR, mod:bc.FIELD},

  	target0:{type:bc.CONTROL, mod:bc.FIELD},		//this is an object, the position of which will be used for highlights

  	blendMode:{type:bc.INTEGER, mod:bc.FIELD, default:0},
  	transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    table:{type:bc.TABLE, mod:bc.FIELD},
    doBuild:{type:bc.BOOLEAN, mod:bc.ACTION}
  }}}
}
bc.ControlFactory.newFactory(GridShaderMaterial);









//Diorama Shader Experiment
class DioramaTestShaderMaterial extends bc.control.Material {
  //todo: make the vec3 for origin behave more like other vec3s throughout the code - so that it's specified like {x:123, y:123, z:123} in html
  alpha = 1.0; baseColor = 0xffffff; worldRadius = 10; transparent = false;
  origin = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0}); tiling = {u:10, v:10};
  init(inDesign) {
    this.uniforms = {
      alpha: { value: Number(this.alpha) },
      colorMap: { value: this.colorMap.value },
      baseColor: { value: new THREE.Color(this.baseColor) },
      tiling: { value: new THREE.Vector2(this.tiling.u, this.tiling.v ) },
      worldRadius: { value:Number(this.worldRadius)},
      origin: { value: this.origin },
    };
    this.value = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DioramaTestShaderMaterial.vertexShader,
      fragmentShader: DioramaTestShaderMaterial.fragmentShader
    });
    Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
  }
  static get vertexShader() {return `
    uniform vec2 tiling; // Repeats the texture over the surface of the mesh. Use for e.g. bricks, etc
    uniform float worldRadius; // Determines the distance from origin at which to start fading the scene.

	uniform vec3 origin; //A point in 3D space, even though we only use the X and Z coordinates.

    varying vec2 vUv;
	//varying float dist; // A vertex's distance from the passed-in origin

	varying vec4 worldCoord;

    void main() {

      //initialize these so they get passed to frag shader
      vUv = uv * tiling;

	  //Calculate distance from a Y-axis emanating from the supplied origin.
	  //	For now, only cylinder masks are supported.
      worldCoord = vec4(position, 1.0) * modelMatrix;
	  worldCoord = modelMatrix * vec4(position, 1.0);

      //bring the new vertex position into gl coordinate space (in view frustum, I believe?)
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`}
  static get fragmentShader() {return `
    uniform vec3 baseColor;

    uniform float worldRadius;
    varying vec2 vUv;
	//varying float dist;

	uniform vec3 origin; //A point in 3D space, even though we only use the X and Z coordinates.

	varying vec4 worldCoord;

    uniform sampler2D colorMap;

    void main() {
      //Just show the texture fullbright for now
      vec4 texColor = texture2D(colorMap, vUv);

	  float dist = distance( vec2(worldCoord.x, worldCoord.z), vec2( origin.x, origin.z ) );

	  float fade = smoothstep( worldRadius - 0.9, worldRadius + 0.9, dist );

//	  gl_FragColor = vec4(baseColor * texColor.rgb, texColor.a * (1.0 - fade));
	  gl_FragColor = vec4(baseColor * texColor.rgb, (1.0 - fade));
  }`}
  static get definition() {return {name:'DioramaTestShaderMaterial', type:bc.CLASS, childMap:{
  	alpha:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
  	baseColor:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	tiling:{type:'_Tiling', mod:bc.FIELD},
  	worldRadius:{ type:bc.FLOAT, mod:bc.FIELD, default:10},
  	origin:{type:bc.VECTOR, mod:bc.FIELD},
  	colorMap:{type:bc.CONTROL, mod:bc.FIELD},
  	transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
  }}}
}
bc.ControlFactory.newFactory(DioramaTestShaderMaterial);

//Diorama Glow Shader
class DioramaGlowShaderMaterial extends bc.control.Material {
  //todo: make the vec3 for origin behave more like other vec3s throughout the code - so that it's specified like {x:123, y:123, z:123} in html
  tiling = {u:10, v:10};
  init(inDesign) {
    this.startTime = Date.now();
    this.uniforms = {
      alpha: { value: this.alpha },
      colorMap: { value: this.colorMap.value },
      baseColor: { value: new THREE.Color(this.baseColor) },
      glowColor: { value: new THREE.Color(this.glowColor) },
      tiling: { value: new THREE.Vector2(this.tiling.u, this.tiling.v ) },
      glowNear: { value: this.glowNear },
      glowMid: { value: (this.glowNear + this.glowFar) / 2 },
      glowFar: { value: this.glowFar },
    };
    this.value = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DioramaGlowShaderMaterial.vertexShader,
      fragmentShader: DioramaGlowShaderMaterial.fragmentShader
    });
    Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
  }
  static get vertexShader() {return `
    uniform vec2 tiling; // Repeats the texture over the surface of the mesh. Use for e.g. bricks, etc

    varying vec2 vUv;

	varying vec4 worldCoord;

    void main() {

      //initialize these so they get passed to frag shader
      vUv = uv * tiling;

	  //Calculate distance from a Y-axis emanating from the supplied origin.
	  //	For now, only cylinder masks are supported.
      worldCoord = vec4(position, 1.0) * modelMatrix;
	  worldCoord = modelMatrix * vec4(position, 1.0);

      //bring the new vertex position into gl coordinate space (in view frustum, I believe?)
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`}
  static get fragmentShader() {return `
    uniform vec3 baseColor;
    uniform vec3 glowColor;

    varying vec2 vUv;
	//varying float dist;

	uniform float glowNear; //A point in 3D space, even though we only use the X and Z coordinates.
	uniform float glowMid; //A point in 3D space, even though we only use the X and Z coordinates.
	uniform float glowFar; //A point in 3D space, even though we only use the X and Z coordinates.

	varying vec4 worldCoord;

    uniform sampler2D colorMap;

    void main() {
      //Just show the texture fullbright for now
      vec4 texColor = texture2D(colorMap, vUv);

	  float dist = distance( worldCoord.z, 0.0 );

	  float fade = smoothstep( glowNear, glowFar, dist );
	  float fade2 = smoothstep( glowMid, glowFar, dist );

	  vec3 outCol = mix(baseColor * texColor.rgb, glowColor, fade) + vec3(fade2 * 0.5);

	  //gl_FragColor = vec4(baseColor * texColor.rgb + (glowColor * fade), 1.0);

	  //gl_FragColor = vec4(mix(baseColor * texColor.rgb, glowColor, fade), 1.0);

	  gl_FragColor = vec4(outCol, 1.0);
  }`}
  static get definition() {return {name:'DioramaGlowShaderMaterial', type:bc.CLASS, childMap:{
  	alpha:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
  	baseColor:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	glowColor:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
  	tiling:{type:'_Tiling', mod:bc.FIELD},
  	glowNear:{ type:bc.FLOAT, mod:bc.FIELD, default:2},
  	glowFar:{ type:bc.FLOAT, mod:bc.FIELD, default:10},
  	colorMap:{type:bc.CONTROL, mod:bc.FIELD},
  	transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
  	blendMode:{type:bc.INTEGER, mod:bc.FIELD, default:0},
  	side:{type:bc.INTEGER, mod:bc.FIELD, default:0},
  }}}
}
bc.ControlFactory.newFactory(DioramaGlowShaderMaterial);

//Tree Shader Experiment
class TreeTestShaderMaterial extends AnimatedMaterial {
  alpha = 1.0; baseColor = 0xffffff; timeMsec = 1.0; pulseRate = 1.0; thickness = 1.0; transparent = false; blendMode = 0; size = 0;
  init(inDesign) {
    this.startTime = Date.now();
    this.uniforms = {
      alpha: { value: this.alpha },
      colorMap: { value: this.colorMap.value },
      baseColor: { value: new THREE.Color(this.baseColor) },
      timeMsec: { value: this.timeMsec },
      pulseRate: { value: this.pulseRate },
      thickness: { value: this.thickness }
    };
    this.value = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: TreeTestShaderMaterial.vertexShader,
      fragmentShader: TreeTestShaderMaterial.fragmentShader
    });
    Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
    this.doPlayPromise(120000000);
  }
  static get vertexShader() {return `
    uniform float timeMsec; // A-Frame time in milliseconds. (Will I have to fix this bit when we move away from A-Frame?)
    uniform float pulseRate;
    uniform float thickness;

    varying vec2 vUv;

	varying float offset;

    //#ifdef USE_COLOR
      // vertex color attribute
     //attribute vec3 color;		//I think vertex color is not happening, for now
   // #endif

    void main() {
	  //vec3 offset = vec3(0.0, 0.25, 0.0);

      //initialize these so they get passed to frag shader
      vUv = uv;
      //norm = normal;

	  //Okay here's the plan: (sin(time + x) * (1 - 0.5(sin(time + z)))) determines the offset in space
	  //It gets attenuated by Y, to make the top of the tree sway and not the bottom. Need a smoothstep in here
	  //So this is all pretty straightforward until I go back to Maya for vertex colors

      //calculate object scale - this can stay for the tree, for now. Not sure how relevant it'll be for trees
      vec3 oScale = vec3(
        length(vec3(modelMatrix[0].x, modelMatrix[1].x, modelMatrix[2].x)), // scale x axis
        length(vec3(modelMatrix[0].y, modelMatrix[1].y, modelMatrix[2].y)), // scale y axis
        length(vec3(modelMatrix[0].z, modelMatrix[1].z, modelMatrix[2].z))  // scale z axis
      );

      //convert input time (ms) to seconds
      float time = timeMsec / 1000.0;

      //set oscillation speed by converting to radians/sec -> this can also stay for the tree, but will be repurposed
      float osc = time * 6.28318530718 * pulseRate;

      //build the offset weights here
      offset = (
	    sin( 0.17 * osc + position.x ) *
		(0.5 - 0.5 * sin( 0.11 * osc + position.z )) *
		sin(0.23 * osc) * smoothstep( 2.0, 8.0, position.y )
		) * thickness +
		(sin( 1.13 * osc + vUv.x ) * (smoothstep( 0.75, 1.0, vUv.y ) * 0.5 + smoothstep( 0.9, 1.0, vUv.y )) * 1.5 );

	  //alternate offset (for diorama leaves)
	  vec4 worldCoord = modelMatrix * vec4(position, 1.0);

	  float uvDist = distance(vUv.xy, vec2(0.0, 0.0));
	  offset = (
		(0.6 - 0.5 * sin( 0.76 * osc + worldCoord.x ))
		* smoothstep(0.1, 1.0, (sin( 10.0 * worldCoord.x + 2.0 * osc)))
		* smoothstep(0.1, 0.5, distance(vUv, vec2(0.5, 0.5)))
		* (sin(osc*3.0+ worldCoord.x*80.0 + worldCoord.y*30.0) * 0.6 + 0.4)
		);

      //apply offset along normal to find new vertex position
      vec3 newPosition = position + vec3(0.017, 0.001, 0.003) * offset;

	 // #ifdef USE_COLOR
	//  newPosition = position + vec3(0.0, 10.0, 0.0) * color;
     // #endif

      //bring the new vertex position into gl coordinate space (in view frustum, I believe?)
      gl_Position = projectionMatrix * modelViewMatrix * vec4( newPosition, 1.0 );
  }`}
  static get fragmentShader() {return `
    uniform vec3 baseColor;
    uniform float alpha;
    varying vec2 vUv;

	varying float offset;

    uniform sampler2D colorMap;

    void main() {
      //send out the
	  //vUv = uv;

      //Just show the texture fullbright for now
      vec4 texColor = texture2D(colorMap, vUv);

      gl_FragColor = vec4(0.5, 0.8, 0.9, alpha);

      gl_FragColor = vec4(baseColor, alpha);

	  gl_FragColor = vec4(texColor.r, texColor.g, texColor.b, 1.0);

//	  gl_FragColor = vec4( fract(max(offset, 0.0)), fract(max(offset-1.0, 0.0)), fract(max(offset-2.0, 0.0)), 1.0);
  }`}
  static get definition() {return {name:'TreeTestShaderMaterial', type:bc.CLASS, childMap:{
    alpha:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
    baseColor:{ type:bc.INTEGER, mod:bc.FIELD, default:0xffffff },
    timeMsec:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
    pulseRate:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 },
    thickness:{ type:bc.FLOAT, mod:bc.FIELD, default:1.0 }, //note that these are holdovers from the outline shader, and I think they're not used
    colorMap:{type:bc.CONTROL, mod:bc.FIELD},
    transparent:{type:bc.BOOLEAN, mod:bc.FIELD, default:false},
    blendMode:{type:bc.INTEGER, mod:bc.FIELD, default:0},
    side:{type:bc.INTEGER, mod:bc.FIELD, default:0},
  }}}
}
bc.ControlFactory.newFactory(TreeTestShaderMaterial);


/**
 * 	Implementation of 'Box-Projected Cube Environment Mapping' (BPCEM)
 * 	Adjusts the reflection angles so that the environment map
 * 		reflects a room of fixed size, rather than an infinitely
 * 		large sphere.
 * 	Limited to rectangular shaped rooms.
 * 	'roomCenter' is the vec3 position of the center of the room
 * 	'roomScale' is the vec3 dimensions of the room in meters
 *
 * 	Todo: We should rename this something more descriptive
 */
class MeshSpecialMaterial extends bc.control.MeshStandardMaterial {
  roomCenter = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0}); roomScale = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0});
  hasRoomScale = false; hasRoomCenter = false;
  isCompiled = false;

  init(inDesign) {
		if (inDesign.roomScale) this.hasRoomScale = true;	//necessary to allow these to update one at a time
		if (inDesign.roomCenter) this.hasRoomCenter = true;

		if (this.hasRoomScale && this.hasRoomCenter) {		//check that both BPCEM fields have been set
			this.value.onBeforeCompile = (shader)=> {
				shader.uniforms.cubeMapPos = { value: this.roomCenter};
				shader.uniforms.cubeMapSize = { value: this.roomScale };

				shader.vertexShader = 'varying vec3 vWorldPosition;\n' + shader.vertexShader;
				shader.vertexShader = shader.vertexShader.replace(
					'#include <worldpos_vertex>',
					MeshSpecialMaterial.worldposReplace
				);
				shader.fragmentShader = shader.fragmentShader.replace(
					'#include <envmap_physical_pars_fragment>',
					MeshSpecialMaterial.envmapPhysicalParsReplace
				);
			};
		} else if (!this.isCompiled) {				//I didn't see a built-in Three.JS variable that would check this
			//complain about missing fields, but only the first time
			console.warn("MeshSpecialMaterial: BPCEM Values Not Set.\r\nReverting to StandardMaterial");
		}
		this.isCompiled = true;
  }
  static get worldposReplace() {return `
	#define BOX_PROJECTED_ENV_MAP

	#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP )
		vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );

		#ifdef BOX_PROJECTED_ENV_MAP
			vWorldPosition = worldPosition.xyz;

		#endif
	#endif
  `}
  static get envmapPhysicalParsReplace() {return `
	#if defined( USE_ENVMAP )
		#define BOX_PROJECTED_ENV_MAP

		#ifdef BOX_PROJECTED_ENV_MAP
			uniform vec3 cubeMapSize;
			uniform vec3 cubeMapPos;
			varying vec3 vWorldPosition;

			//Originally, this function was prone to return a vec3 full of NaN and +-Inf.
			vec3 parallaxCorrectNormal( vec3 v, vec3 cubeSize, vec3 cubePos ) {

				vec3 nDir = normalize( v + vec3(0.000000001) );	//kick the n/0 error like a millionth of a degree sideways, so that it becomes astronomically unlikely to be a problem
				vec3 rbmax = ( .5 * cubeSize + cubePos - vWorldPosition ) / nDir;
				vec3 rbmin = ( -.5 * cubeSize + cubePos - vWorldPosition ) / nDir;

				vec3 rbminmax;
				rbminmax.x = ( nDir.x > 0. ) ? rbmax.x : rbmin.x;
				rbminmax.y = ( nDir.y > 0. ) ? rbmax.y : rbmin.y;
				rbminmax.z = ( nDir.z > 0. ) ? rbmax.z : rbmin.z;

				float correction = min( min( rbminmax.x, rbminmax.y ), rbminmax.z );
				vec3 boxIntersection = vWorldPosition + nDir * correction;

				return boxIntersection - cubePos;
			}
		#endif

		#ifdef ENVMAP_MODE_REFRACTION
			uniform float refractionRatio;
		#endif


		vec3 getLightProbeIndirectIrradiance( const in GeometricContext geometry, const in int maxMIPLevel ) {
			vec3 worldNormal = inverseTransformDirection( geometry.normal, viewMatrix );

			#ifdef ENVMAP_TYPE_CUBE
				#ifdef BOX_PROJECTED_ENV_MAP
					worldNormal = parallaxCorrectNormal( worldNormal, cubeMapSize, cubeMapPos );
				#endif
				vec3 queryVec = vec3( flipEnvMap * worldNormal.x, worldNormal.yz );
				// TODO: replace with properly filtered cubemaps and access the irradiance LOD level, be it the last LOD level
				// of a specular cubemap, or just the default level of a specially created irradiance cubemap.
				#ifdef TEXTURE_LOD_EXT
					vec4 envMapColor = textureCubeLodEXT( envMap, queryVec, float( maxMIPLevel ) );
				#else
					// force the bias high to get the last LOD level as it is the most blurred.
					vec4 envMapColor = textureCube( envMap, queryVec, float( maxMIPLevel ) );
				#endif
				envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;


			#elif defined( ENVMAP_TYPE_CUBE_UV )
				#ifdef BOX_PROJECTED_ENV_MAP
					worldNormal = normalize( parallaxCorrectNormal( worldNormal, cubeMapSize, cubeMapPos ) );
				#endif

				vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );

			#else
				vec4 envMapColor = vec4( 0.0 );
			#endif

			return PI * envMapColor.rgb * envMapIntensity;
		}

		// Trowbridge-Reitz distribution to Mip level, following the logic of http://casual-effects.blogspot.ca/2011/08/plausible-environment-lighting-in-two.html
		float getSpecularMIPLevel( const in float roughness, const in int maxMIPLevel ) {
			float maxMIPLevelScalar = float( maxMIPLevel );
			float sigma = PI * roughness * roughness / ( 1.0 + roughness );
			float desiredMIPLevel = maxMIPLevelScalar + log2( sigma );
			// clamp to allowable LOD ranges.
			return clamp( desiredMIPLevel, 0.0, maxMIPLevelScalar );
		}

		vec3 getLightProbeIndirectRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in int maxMIPLevel ) {

			#ifdef ENVMAP_MODE_REFLECTION
				vec3 reflectVec = reflect( -viewDir, normal );
				// Mixing the reflection with the normal is more accurate and keeps rough objects from gathering light from behind their tangent plane.
				//	Check here for reflectVec problems (YC - adding a coefficient here fixes n/0 in specular, but not diffuse, CubeUV lookup)
				reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			#else
				vec3 reflectVec = refract( -viewDir, normal, refractionRatio );
			#endif

			//	Check here for reflectVec problems
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			float specularMIPLevel = getSpecularMIPLevel( roughness, maxMIPLevel );

			#ifdef ENVMAP_TYPE_CUBE
				#ifdef BOX_PROJECTED_ENV_MAP
					reflectVec = parallaxCorrectNormal( reflectVec, cubeMapSize, cubeMapPos );
				#endif

				vec3 queryReflectVec = vec3( flipEnvMap * reflectVec.x, reflectVec.yz );

				#ifdef TEXTURE_LOD_EXT
					vec4 envMapColor = textureCubeLodEXT( envMap, queryReflectVec, specularMIPLevel );
				#else
					vec4 envMapColor = textureCube( envMap, queryReflectVec, specularMIPLevel );
				#endif

				envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;

			#elif defined( ENVMAP_TYPE_CUBE_UV )
				#ifdef BOX_PROJECTED_ENV_MAP
					reflectVec = parallaxCorrectNormal( reflectVec, cubeMapSize, cubeMapPos );
				#endif

				vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );

			#elif defined( ENVMAP_TYPE_EQUIREC )
				vec2 sampleUV;
				sampleUV.y = asin( clamp( reflectVec.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
				sampleUV.x = atan( reflectVec.z, reflectVec.x ) * RECIPROCAL_PI2 + 0.5;
				#ifdef TEXTURE_LOD_EXT
					vec4 envMapColor = texture2DLodEXT( envMap, sampleUV, specularMIPLevel );
				#else
					vec4 envMapColor = texture2D( envMap, sampleUV, specularMIPLevel );
				#endif
				envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;

			#elif defined( ENVMAP_TYPE_SPHERE )
				vec3 reflectView = normalize( ( viewMatrix * vec4( reflectVec, 0.0 ) ).xyz + vec3( 0.0,0.0,1.0 ) );
				#ifdef TEXTURE_LOD_EXT
					vec4 envMapColor = texture2DLodEXT( envMap, reflectView.xy * 0.5 + 0.5, specularMIPLevel );
				#else
					vec4 envMapColor = texture2D( envMap, reflectView.xy * 0.5 + 0.5, specularMIPLevel );
				#endif
				envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;
			#endif
			return envMapColor.rgb * envMapIntensity;
		}
	#endif
  `}
  static get definition() {return {name:'SpecialMaterial', type:bc.CLASS, childMap:{
	roomCenter:{type:bc.VECTOR, mod:bc.FIELD},
	roomScale:{type:bc.VECTOR, mod:bc.FIELD},
  }}}
}
bc.ControlFactory.newFactory(MeshSpecialMaterial);

class TeleportShaderMaterial extends AnimatedMaterial {
  color = 0xffffff;
  init(inDesign) {
    var color = new THREE.Color(this.color);
    color.convertSRGBToLinear();
    this.startTime = Date.now();
    this.uniforms = {
      color: {type: 'color', is: 'uniform'},
      timeMsec: {type: 'time', is: 'uniform'}
    };
    this.uniforms.color.value = color;
    this.value = new THREE.ShaderMaterial( {
      uniforms: this.uniforms,
      fragmentShader: TeleportShaderMaterial.fragmentShader,
      vertexShader: TeleportShaderMaterial.vertexShader
    });
    this.value.transparent = true;
    this.value.blending = THREE.AdditiveBlending;
    this.value.side = THREE.FrontSide;
    this.value.needsUpdate = true;
    this.doPlayPromise(6250);
  }
  static get vertexShader() {return `
    // vertex.glsl

    varying vec2 vUv;
    varying vec3 norm;
    varying vec4 worldCoord;

    void main() {
      //initialize these so they get passed to frag shader
      vUv = uv;
      norm = normal;
      worldCoord = vec4(position, 1.0) * modelMatrix;

      //establish vertex position
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `}
  static get fragmentShader() {return `
    // fragment.glsl

    varying vec2 vUv;
    varying vec3 norm;
    uniform vec3 color;
    uniform float timeMsec; // A-Frame time in milliseconds.

    varying vec4 worldCoord;

    void main() {
      float time = timeMsec / 1000.0; // Convert from A-Frame milliseconds to typical time in seconds.

      /**
       * Intensity of rising line effect.
       *   Uses sin() oscillator with height.
       *   Coefficient for worldCoord.y sets number of lines.
       *   Coefficient for time sets how fast they move.
       */
      float factor1 = sin((worldCoord.y * 80.0) - time * 8.0);

      /**
       * Floor brightness.
       *   Control intensity with coefficient of norm.y
       */
      float floorBoost = norm.y * 0.9 * vUv.y;

      /**
       * Color multiplyer for rising line effect.
       *   I got these numbers through pure trial and error and I don't really understand how they fit together.
       *   It serves to taper off the lines as they approach the ceiling.
       */
      float rippleBoost = (factor1 * 0.6 + (norm.y / 1.3)) * 0.7 * vUv.y;

      /**
       * Beauty pass, if you will.
       *   Take the brightest per-pixel color from either the floor or the lines.
       *   Then colorize that with the input color.
       *   (And don't forget alpha = 1.0)
       */
      gl_FragColor = vec4(
        clamp(max(rippleBoost, floorBoost) * color, 0.0, 1.0),
        1.0
      );
    }`}
    static get definition() {return {name:'TeleportShaderMaterial', type:bc.CLASS, childMap:{color:{type:bc.INTEGER, mod:bc.FIELD, default:0xffffff}}}}
};
bc.ControlFactory.newFactory(TeleportShaderMaterial);


//Sky Deck River - ideally this will have two or more scrolling noise displacements for 'waves' and I'll borrow envmap reflection from standardmaterial
//	Hmm, I also have to work out transparency... I've done it in the diorama materials I think?
//	Oh, the teleport handler material is transparent. so we're good
//About the envmap though:
//	ThreeJS' phenomenally useful documentation THINKS there's a demo of applying HDRIs to a ShaderMaterial, but there actually isn't. Great.
//	So in lieu of an easy example, I have to choose between two options:
//	- I can implement envmaps into a ShaderMaterial, which might be easy BUT will possibly never look correct and requires me to implement normals from the ground up as well.
//  - Or I can inject ripples into a MeshStandardMaterial. This will be the best-looking option, but will take a lot of research, may be impossible, and isn't as performant.
//
//	Let's try the injection method. Start here: https://medium.com/@pailhead011/extending-three-js-materials-with-glsl-78ea7bbb9270
//		There are some broken links to the MeshStandardMaterial definition that can point me towards modifying the correct chunks.
//		We also already have a successful onBeforeCompile() call in our MeshSpecialMaterial.
//		So I think I need the following steps:
//			0. Print out the entire default shader definition. This should be doable with onBeforeCompile() according to this Dusan Bosnjak guy.
//				(or I can look at github)
//			1. Generate a decent water flow pattern in GLSL
//				a. Option one: on-GPU perlin/simplex noise. Difficult, more dynamic, expensive?, I'm not smart enough to do this without needing an MIT license, also.
//				b. Option two: reuse my noise technique from the Brainwave shader. Easier, less dynamic, expensive?, requires injecting a new texture into modified StandardMaterial...
//				c. Option three: I can use vertex displacement. This will make normals a little tidier AND ought to be the cleanest integration with StandardMaterial...
//					Current solvable: how the heck do I access the uniforms for a material other than ShaderMaterial?
//			2. Convert it to normals (surely the algorithm for this will be an easy google) (Not required for option three, Sort Of)
//					My god the algorithm for this certanly is not an easy google
//			3. Inject it into a MeshStandardMaterial; perhaps in place of the normal texture lookup?
//				(although normal texture lookup will probably be skipped if a texture isn't defined...)
//					Well, as it stands I do have a texture. So it won't get skipped. Can I find the place where StandardMaterial polls the normal map,
//						inject a simple diy noise function, and then overlay that with the normal map?
//					This sounds pretty good... BUT it will need an injected uniform for the noise's timer. Ugh
//			4. And that SHOULD do it. We'll see
//
//	Ah, ah ah ah ah. This is a good enough idea to list separately. Would it be performant to create the normal map from scratch in one shader, then
//		take its output and plug it into the water???
//	Cons: Memory footprint
//			Bandwidth issue likely from the texture going between memory/cpu/gpu every frame
//
//	Another clever idea: Okay, keep in mind that water ripples will be messy and weird. so perfect, physically accurate normal blending isn't critical.
//		So I can do on-the-spot blending with whatever simple algorithm is Good Enough, and I can do it right inside the StandardMaterial IF I can find
//		  where it does the lookup.
//		What I can do, then, is be cheeky and just repeat the lookup at a different scale - and I'm sure I can force that varied scale to also affect
//		  the scrolling speed of the second lookup. That would work.
//
//	Definitely going with that last plan. So let's figure out where to inject the second normal call.
//
class SkyDeckRiverMaterial extends bc.control.MeshStandardMaterial {
//	color = 0xffff; timeMsec = 1.0; opacity = 0.1; //blending = THREE.AdditiveBlending;
//  roomCenter = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0}); roomScale = bc.World.newType(bc.VECTOR, {x:0, y:0, z:0});
//  hasRoomScale = false; hasRoomCenter = false;
  isCompiled = false;

  init(inDesign) {
		if (inDesign.roomScale) this.hasRoomScale = true;	//necessary to allow these to update one at a time
		if (inDesign.roomCenter) this.hasRoomCenter = true;

//		this.uniforms.timeMsec = 0;

	//	var shaderRef;

		this.value.onBeforeCompile = (shader) => {
//			this.shaderRef = shader;
//			console.log(this.shaderRef);
			shader.uniforms.timeMsec = { value: 0}
			shader.uniforms.cubeMapPos = { value: this.roomCenter};
			shader.uniforms.cubeMapSize = { value: this.roomScale };

			shader.vertexShader = 'varying vec3 vWorldPosition;\nuniform float timeMsec;\n' + shader.vertexShader;
			shader.vertexShader = shader.vertexShader.replace(
				'#include <begin_vertex>',
				SkyDeckRiverMaterial.vertexRipple
			);


			shader.fragmentShader = 'uniform float timeMsec;\n' + shader.fragmentShader;
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <normal_fragment_maps>',
				SkyDeckRiverMaterial.normDuplicate
			);
/*				shader.fragmentShader = shader.fragmentShader.replace(
				'#include <envmap_physical_pars_fragment>',
//				SkyDeckRiverMaterial.envmapPhysicalParsReplace

				'#include <envmap_physical_pars_fragment>'
			);		//*/



	//		console.log("Trying to find shader: ");
	//		console.log(shader);
      this.doPlayPromise(shader);
		};
		this.isCompiled = true;
  }
  async doPlayPromise(shader) {
    this.process = this.processor.newProcess({name:'AnimatedMaterial'});
    let now = Date.now();
    let startTime = now;
    do {
      let elapsedMilliseconds = now - startTime;
      shader.uniforms.timeMsec.value = elapsedMilliseconds % 12000;
      now = await this.process.tickWait();
    } while (now > 0);
    this.processor.removeProcess(this.process);
  }

	static get normDuplicate() {return `
		//Second normal sample goes here
		#ifdef OBJECTSPACE_NORMALMAP

			normal = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0; // overrides both flatShading and attribute normals

			#ifdef FLIP_SIDED
				normal = - normal;
			#endif

			#ifdef DOUBLE_SIDED
				normal = normal * faceDirection;
			#endif

			normal = normalize( normalMatrix * normal );

		#elif defined( TANGENTSPACE_NORMALMAP )

			vec3 mapN = texture2D( normalMap, vUv + vec2(timeMsec/16000.0, timeMsec/3600.0) ).xyz * 2.0 - 1.0;
			vec3 mapN2 = texture2D( normalMap, vUv * 0.83 + vec2(-timeMsec/16300.0, timeMsec/3273.0) ).xyz * 2.0 - 1.0;
			mapN = normalize(mapN + mapN2);
			mapN.xy *= normalScale;

			#ifdef USE_TANGENT
				normal = normalize( vTBN * mapN );
			#else
				normal = perturbNormal2Arb( -vViewPosition, normal, mapN, faceDirection );
			#endif

		#elif defined( USE_BUMPMAP )
			normal = perturbNormalArb( -vViewPosition, normal, dHdxy_fwd(), faceDirection );
		#endif
	`}

  static get vertexRipple() {return `
        vec3 transformed = vec3(position);
        float freq = 30.0;
        float amp = 0.05;
		float waveSpeed = 1000.0;
 //       float angle = (timeMsec/100.0 + position.x)*freq;
        float angle = (timeMsec/waveSpeed + uv.y)*freq;
 //       transformed += sin(angle)*amp * objectNormal;


		float shiftTime = sin(timeMsec + sin(uv.x * 30.0 + timeMsec));

		float offset = (sin(uv.y * 7.74763 + timeMsec/waveSpeed * 8.0) +
        			sin(uv.y * 8.177283 + shiftTime/waveSpeed*11.185 ) * 0.6 +
        			sin(uv.y * 5.938371 + shiftTime/waveSpeed*7.8115 ) * 0.3 +
        			sin(uv.x * 1.11111 + timeMsec/waveSpeed*1.8115 ) * 0.1 +
        			sin(uv.x * 0.93 - timeMsec/waveSpeed*1.3115 ) * 0.1 +
        			0.0)*amp;

		//rolling offset; can be added to
		float offset1 = sin((timeMsec/waveSpeed + uv.y * sin(timeMsec/(waveSpeed * 1.0) + uv.x))*freq) * amp;
		//rolling offset; can be added to
		float offset2 = sin((timeMsec/(waveSpeed * 1.8273) + uv.y * sin(timeMsec/(waveSpeed * 1.0) + uv.x))*freq/1.3828) * amp;
		//rolling offset; can be added to
		float offset3 = sin((timeMsec/(waveSpeed * 2.8273) + uv.x)*freq/10.3828) * amp * 2.0;

//		offset = 0.0;

		//apply offsets along normal
		transformed += (offset) * objectNormal;

//		objectNormal = normalize(vec3(-amp * freq * cos(angle),0.0,1.0));		//Basis. Built for a z-up system, for some reason.
//		objectNormal = normalize(vec3(1.0,0.0,-amp/5.0 * freq * cos(angle)));
//		objectNormal = normalize(vec3(amp * 0.01 * freq * cos(angle),1.0,0.0));
		vNormal = normalMatrix * objectNormal;
    `}

  static get definition() {return {name:'SkyDeckRiverMaterial', type:bc.CLASS, childMap:{
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    flowSpeed:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
  }}}
}
bc.ControlFactory.newFactory(SkyDeckRiverMaterial);



class EntryShaderMaterial extends AnimatedMaterial {
  color = 0xffff; timeMsec = 1.0;
  init(inDesign) {
    this.startTime = Date.now();
    this.uniforms = {color:{value:new THREE.Color(this.color)}, timeMsec:{value:this.timeMsec}};
    this.value = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: EntryShaderMaterial.vertexShader,
        fragmentShader: EntryShaderMaterial.fragmentShader
      });
    this.value.needsUpdate = true;
    this.doPlayPromise(999999999); //Another shader that doesn't loop well... because of the slow color shift
  }
  static get vertexShader() {return `
    // vertex.glsl

    varying vec2 vUv;
    varying vec3 norm;
    varying vec4 worldCoord;

    void main() {
      //initialize these so they get passed to frag shader
      vUv = uv;
      norm = normal;
      worldCoord = vec4(position, 1.0) * modelMatrix;

      //establish vertex position
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`
  }
  static get fragmentShader() {return `
    // fragment.glsl

    varying vec3 norm;
    uniform vec3 color;
    uniform float timeMsec; // A-Frame time in milliseconds.

    varying vec4 worldCoord;

    void main() {
      float time = timeMsec / 1000.0; // Convert from A-Frame milliseconds to typical time in seconds.

      /**
       * Intensity of rising line effect.
       *   Uses sin() oscillator with height.
       *   Coefficient for worldCoord.y sets number of lines.
       *   Coefficient for time sets how fast they move.
       */
      float factor1 = sin((worldCoord.y * 40.0) - time * 4.0);

      /**
       * Floor brightness.
       *   Control intensity with coefficient of norm.y
       */
      float floorBoost = norm.y * 0.9;

      /**
       * Color multiplyer for rising line effect.
       *   I got these numbers through pure trial and error and I don't really understand how they fit together.
       *   It serves to taper off the lines as they approach the ceiling.
       */
      float rippleBoost = (factor1 * 0.6 + (norm.y / 1.3)) * 0.7;

      /**
       * Additional color blended in to make the scene more dynamic.
       *   Crude approximation of hue oscillation, which is too expensive to really implement.
       *   Note the coefficient, which affects the strength of the effect.
       *   Increasing this too far will blow out the image.
       */
      vec3 offsetColor = vec3(
        sin(time * 0.5) * 0.05,
        sin(time * 0.5 + 2.0944) * 0.05,
        sin(time * 0.5 + 4.1888) * 0.05);

      /**
       * Beauty pass, if you will.
       *   Take the brightest per-pixel color from either the floor or the lines.
       *   Then colorize that with the input color.
       *   Finally, apply the offset color for subtle variation.
       *   (And don't forget alpha = 1.0)
       */
      gl_FragColor = vec4(
        max(rippleBoost, floorBoost) * color + offsetColor,
        1.0
      );
    }`
  }
  static get definition() {return {name:'EntryShaderMaterial', type:bc.CLASS, childMap:{
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0xffff},
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0}
  }}}
}
bc.ControlFactory.newFactory(EntryShaderMaterial);




class OutlineShaderMaterial extends AnimatedMaterial {
  alpha = 1; color = 0x0000ff; opacity = 1.0; timeMsec = 1.0; pulseRate = .3; thickness = 1; transparent = false;
  init(inDesign) {
    this.uniforms = {
      alpha:{value:Number(this.alpha)},
      color:{value:new THREE.Color(Number(this.color))},
      timeMsec:{value:Number(this.timeMsec)},
      pulseRate:{value:Number(this.pulseRate)},
      thickness:{value:Number(this.thickness)}
    };
    this.value = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: OutlineShaderMaterial.vertexShader,
      fragmentShader: OutlineShaderMaterial.fragmentShader
    });
    Object.assign(this.value, {transparent:this.transparent, side:THREE.BackSide, needsUpdate:true, opacity:this.opacity});
    this.doPlayPromise(1591.54943);
  }
  static get vertexShader() {return `
    uniform float timeMsec; // A-Frame time in milliseconds. (Will I have to fix this bit when we move away from A-Frame?)
    uniform float pulseRate;
    uniform float thickness;

    void main() {
      //calculate object scale
      vec3 oScale = vec3(
      length(vec3(modelMatrix[0].x, modelMatrix[1].x, modelMatrix[2].x)), // scale x axis
      length(vec3(modelMatrix[0].y, modelMatrix[1].y, modelMatrix[2].y)), // scale y axis
      length(vec3(modelMatrix[0].z, modelMatrix[1].z, modelMatrix[2].z))  // scale z axis
      );

      //convert input time (ms) to seconds
      float time = timeMsec / 1000.0;

      //set oscillation speed by converting to radians/sec
      float osc = time * 6.28318530718 * pulseRate;

      //approximate a squarewave (if performance is a problem, it'll be here)
//      float offset = (0.0085 + 0.005 * (
//      cos(osc) +
//      cos(osc * 3.0) / 2.7 +
//      cos(osc * 5.0) / 8.0)) * thickness;

	  //alternate offset calculation, using smoothstep:
	  float offset = (0.0045 + 0.0055 * smoothstep(-0.7, 0.7, sin(osc))) * thickness;

      //apply offset along normal to find new vertex position
      vec3 newPosition = position + normalize(normal) * offset / oScale;

      //bring the new vertex position into gl coordinate space (in view frustum, I believe?)
      gl_Position = projectionMatrix * modelViewMatrix * vec4( newPosition, 1.0 );
  }`}
  static get fragmentShader() {return `
    uniform vec3 color;
    uniform float alpha;

    void main() {
      //send out the color
      gl_FragColor = vec4(color, alpha);
  }`}
  static get definition() {return {name:'OutlineShaderMaterial', type:bc.CLASS, childMap:{
    alpha:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0x0000ff},
    opacity:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    pulseRate:{type:bc.FLOAT, mod:bc.FIELD, default:.3},
    thickness:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    transparent:{type:bc.BOOLEAN, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(OutlineShaderMaterial);


class BrainwaveShaderMaterial extends AnimatedMaterial {
  alpha = 1; color = 0x0000ff; timeMsec = 1.0; noiseText = null; edgeText = null;
  init(inDesign) {
    //configure texture to remove aliasing
    this.edgeTex.value.wrapS = THREE.RepeatWrapping;
    this.edgeTex.value.wrapT = THREE.RepeatWrapping;
    this.edgeTex.value.magFilter = THREE.NearestFilter;
    this.edgeTex.value.minFilter = THREE.NearestFilter;
    this.edgeTex.value.encoding = THREE.LinearEncoding;
    this.edgeTex.value.premultiplyAlpha = false;

    this.uniforms = {
      timeMsec: { value: 1.0 },
      inColor: {value:new THREE.Color(this.color)},
      noiseTex: { value: this.noiseTex.value },
      edgeTex: { value: this.edgeTex.value }
    };
    this.value = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BrainwaveShaderMaterial.vertexShader,
      fragmentShader: BrainwaveShaderMaterial.fragmentShader
    });
    Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
    this.doPlayPromise(30000, 0.001);	//this is a bad hack. The shader doesn't repeat, so we wait a little more than eight hours before looping. Hopefully nobody will see this.
																				//the bonus is, since I thiiiink every timeMsec use in the shader is divisible by 200 or so, this might actually loop perfectly when it comes around (which is funny)
  }
  static get vertexShader() {return `
    varying vec2 vUv;

	void main() {
		vUv = uv;

		vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * modelViewPosition;
	}`}
  static get fragmentShader() {return `
    #ifdef GL_ES
	precision mediump float;
	#endif

	uniform sampler2D noiseTex; //https://i.imgur.com/geFMpNu.png
	uniform sampler2D edgeTex; //animGreen
	uniform float timeMsec;
	uniform vec3 inColor;
	varying vec2 vUv;

	// 1 on edges, 0 in middle
	//	is this faster than a texture lookup? No idea
	float hex(vec2 p) {
		p.x *= 0.57735*2.0 + 0.05;
		p.y += mod(floor(p.x), 2.0)*0.5;
		p = abs((0.5 - mod(p, 1.0)));
		return abs(max(p.x*1.5 + p.y, p.y*2.0) - 1.0);
	}

	void main(void){
		//st represents stpq, two sets of two dimensions for texture lookup. Think RGBA, XYZW, etc.
		//	but don't ask me why we don't just use uv
		vec2 st = vUv;
		float brightness = 0.0;
		vec3 color = inColor * 2.0; //note that color is multiplied by two

		//clean loop at 20 seconds
		brightness = 5. * pow(
			texture2D(noiseTex, vec2(vUv.x + timeMsec * 0.05, vUv.y + timeMsec * 0.1)).r
		  * texture2D(noiseTex, vec2(vUv.x - timeMsec * 0.1, vUv.y - timeMsec * 0.05)).g
			, 2.9);

		//other half of st; I use this as a scrunched-down and ripply coord space to generate hexagons in
		vec2 pq = vUv * 4.0 + .07 * vec2( sin(timeMsec * 0.9 + vUv.y * 6.792), cos(timeMsec * 0.95 + vUv.x * 4.0));

		//convert pq space to hexagons. The second value in the smoothstep() determines line thickness, the multiplyer on pq determines hex size
		brightness += brightness * 1. * (1.0 - smoothstep(0.0, 0.2, hex(pq * 6.0)));

		//generate hexagons using alpha texture instead
		//	unfortunately, un-premultiplied alpha is broken on iOS, so we can't use this
		//	(I think the lookup was probably more expensive than the procedural approach, anyway)
		//brightness += brightness * (texture2D(noiseTex, (pq + vec2(0.5, 0.)) * vec2(3.64, 6.))).a;

		//add a ring around the outer edge, plus some background brightness so we don't see any pitch-black
		//brightness += pow(2.2 * distance( vUv, vec2(0.5)), 3.) / 1.3 + 0.2;

		//or add a ring around the geometry with a mask
		brightness += texture2D(edgeTex, vUv).r * 0.5 + 0.2;

		vec2 bawa = texture2D(edgeTex, vUv).gb;	//what the hell is bawa
		brightness += pow(mod(bawa.x - timeMsec / 1.0, 1.0) * bawa.y, 4.0);



		//brightness = floor(bawa.x + timeMsec / 1.0) * 2.0 * bawa.y;


		//bring in color, modulated by brightness, for the shader output
		gl_FragColor = vec4(brightness * color,1.0);
		//gl_FragColor = vec4(texture2D(noiseTex, st).rgb, 0.5);
	}`}
  static get definition() {return {name:'BrainwaveShaderMaterial', type:bc.CLASS, childMap:{
    alpha:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0x0000ff}, //doesn't do anything for now
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    noiseTex:{type:bc.CONTROL, mod:bc.FIELD},
    edgeTex:{type:bc.CONTROL, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(BrainwaveShaderMaterial);

class BrainloopShaderMaterial extends AnimatedMaterial {
  init(inDesign) {
    //configure texture to remove aliasing
    this.edgeTex.value.wrapS = THREE.RepeatWrapping;
    this.edgeTex.value.wrapT = THREE.RepeatWrapping;
    this.edgeTex.value.magFilter = THREE.NearestFilter;
    this.edgeTex.value.minFilter = THREE.NearestFilter;
    this.edgeTex.value.encoding = THREE.LinearEncoding;
    this.edgeTex.value.premultiplyAlpha = false;

    this.uniforms = {
      timeMsec: { value: 1.0 },
      inColor: {value:new THREE.Color(this.color)},
      noiseTex: { value: this.noiseTex.value },
      edgeTex: { value: this.edgeTex.value }
    };
    this.value = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BrainloopShaderMaterial.vertexShader,
      fragmentShader: BrainloopShaderMaterial.fragmentShader
    });
    Object.assign(this.value, {transparent:this.transparent, side:THREE.FrontSide, needsUpdate:true});
    this.doPlayPromise(30000, 0.001);	//this is a bad hack. The shader doesn't repeat, so we wait a little more than eight hours before looping. Hopefully nobody will see this.
																			//the bonus is, since I thiiiink every timeMsec use in the shader is divisible by 200 or so, this might actually loop perfectly when it comes around (which is funny)
  }
  static get vertexShader() {return `
    varying vec2 vUv;

	void main() {
		vUv = uv;

		vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * modelViewPosition;
	}`}
  static get fragmentShader() {return `
    #ifdef GL_ES
	precision mediump float;
	#endif

	uniform sampler2D noiseTex; //https://i.imgur.com/geFMpNu.png
	uniform sampler2D edgeTex; //animGreen
	uniform float timeMsec;
	uniform vec3 inColor;
	varying vec2 vUv;


	// 1 on edges, 0 in middle
	//	is this faster than a texture lookup? No idea
	float hex(vec2 p) {
		p.x *= 0.57735*2.0 + 0.05;
		p.y += mod(floor(p.x), 2.0)*0.5;
		p = abs((0.5 - mod(p, 1.0)));
		return abs(max(p.x*1.5 + p.y, p.y*2.0) - 1.0);
	}

	void main(void){
		//st represents stpq, two sets of two dimensions for texture lookup. Think RGBA, XYZW, etc.
		//	but don't ask me why we don't just use uv
		vec2 st = vUv;
		float brightness = 0.0;
		vec3 color = inColor * 2.0; //note that color is multiplied by two

		//clean loop at 20 seconds
		brightness = 5. * pow(
			texture2D(noiseTex, vec2(vUv.x + timeMsec * 0.05, vUv.y + timeMsec * 0.1)).r
		  * texture2D(noiseTex, vec2(vUv.x - timeMsec * 0.1, vUv.y - timeMsec * 0.05)).g
			, 2.9);

		//other half of st; I use this as a scrunched-down and ripply coord space to generate hexagons in
		vec2 pq = vUv * 4.0 + .07 * vec2( sin(timeMsec * 1.0 + vUv.y * 6.792), cos(timeMsec * 1.0 + vUv.x * 4.));

		//convert pq space to hexagons. The second value in the smoothstep() determines line thickness, the multiplyer on pq determines hex size
		brightness += brightness * 1. * (1.0 - smoothstep(0.0, 0.2, hex(pq * 6.0)));

		//generate hexagons using alpha texture instead
		//	unfortunately, un-premultiplied alpha is broken on iOS, so we can't use this
		//	(I think the lookup was probably more expensive than the procedural approach, anyway)
		//brightness += brightness * (texture2D(noiseTex, (pq + vec2(0.5, 0.)) * vec2(3.64, 6.))).a;

		//or add a ring around the geometry with a mask
		brightness += texture2D(edgeTex, vUv).r * 0.5 + 0.2;

		vec2 bawa = texture2D(edgeTex, vUv).gb;	//what the hell is bawa
		brightness += pow(mod(bawa.x - timeMsec / 1.0, 1.0) * bawa.y, 4.0);

		//bring in color, modulated by brightness, for the shader output
		gl_FragColor = vec4(brightness * color,1.0);
	}`}
  static get definition() {return {name:'BrainloopShaderMaterial', type:bc.CLASS, childMap:{
    alpha:{type:bc.FLOAT, mod:bc.FIELD, default:1},
    color:{type:bc.INTEGER, mod:bc.FIELD, default:0x0000ff}, //doesn't do anything for now
    timeMsec:{type:bc.FLOAT, mod:bc.FIELD, default:1.0},
    noiseTex:{type:bc.CONTROL, mod:bc.FIELD},
    edgeTex:{type:bc.CONTROL, mod:bc.FIELD}
  }}}
}
bc.ControlFactory.newFactory(BrainloopShaderMaterial);




export {TreeTestShaderMaterial, ShowroomScreensMaterial, UserBarShimmerMaterial, SampleMaterial, UnderwaterMaterial, DioramaGlowShaderMaterial, BrainloopShaderMaterial, BrainwaveShaderMaterial, OutlineShaderMaterial, GridShaderMaterial, DioramaTestShaderMaterial, EntryShaderMaterial, CloudSpinShaderMaterial, TeleportShaderMaterial, MeshSpecialMaterial}
