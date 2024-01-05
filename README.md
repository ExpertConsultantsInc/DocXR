<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/ExpertConsultantsInc/DocXR/assets/44175739/4dca87ac-3ef0-4f88-9a8c-113393c1be85">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/ExpertConsultantsInc/DocXR/assets/44175739/f054749f-1914-44c1-a89c-f3ceec08e956">
  <img alt="DocXR Logo" src="https://github.com/ExpertConsultantsInc/DocXR/assets/44175739/4dca87ac-3ef0-4f88-9a8c-113393c1be85">
</picture>

## Introduction
DocXR is an experimental web framework with a robust scripting language for building virtual reality experiences. DocXR uses the Three.js library to display 3D computer graphics in a web browser using WebGL. It enables developers to incorporate 3D assets, animation, video, sound, and data with dynamic interactions into custom VR environments. 

DocXR was developed to understand what a metaverse might possibly look like. Its foundation was formed around the attempt to solve the following problems:

* **Standard Framework:**  
This is essential for a true global metaverse. We approached this with the following solutions:
	- Open source code - a free to use software baseline
	- JSON syntax that derives the workflow and object definitions so that it is easier to parse and understand.
	- Browser based execution to allow access on most devices
* **Data Dependance:**  
In order to create a secure environment in which a user's data and interactions are private, the framework must provide the ability for that user to protect and federate his own logic and data to only those who are privileged to use it. We provide some ideas as to how to do this:
	- Each user gets a unique view of each environment based on their access. This includes data and logic. One user's view of an environment might be totally different from another based on the logic they are given or produce.
	- A flexible data standard is used to allow each user to decide how to encode logic and data as well and disseminate the data they receive
	- Encryption on the client side that allows trustless server design to totally secure data, interactions and logic
* **Encapsulated Intelligence:**  
To make complex workflows possible, the framework needs to allow the creation of entities that can operate with their own logic and external requests. Solutions include:
	- A complete logic system inside of the document standard that allows the create of smart objects that can request logic and data as well as execute autonomously or based on a set of external triggers.
	- A peer to peer mesh network that can send entity requests to the right resource.
<br><br>
## Features
* **Open Source**  
Allows developers to freely modify, distribute, and utilize the codebase, fostering a collaborative environment for continuous improvement and innovation.

* **WebXR API Compatibility**  
Supports a range of applications from gaming to educational tools, providing a seamless integration for developers aiming to build cutting-edge VR and AR experiences in a web environment.

* **VR Headset & Desktop Browser Accessibility**  
Ensures a wide reach, allowing users with different devices to access VR content without the need for specialized hardware, thus democratizing the VR experience.

* **Component Architecture**  
Facilitates easier development, maintenance, and scalability with a modular design. Developers can reuse components across different projects and streamline the development process.
<br><br>
## Prerequisites
Before you begin, ensure you have installed the latest version of [Node.js](https://nodejs.org/). Node.js is an open source server environment that runs on various platforms including Windows, Linux, Unix, and Mac OS X.
<br><br>
## Installation
1. Clone the repository to your desktop:
`git clone https://github.com/ExpertConsultantsInc/DocXR.git`

2. Open a terminal window and navigate to the client's js node directory:
`cd Desktop/DocXR/client/js/node`

3. Install client dependencies
`npm install`

4. Navigate to the server directory:
`cd Desktop/DocXR/server`

5. Install server dependencies:
`npm install`

6. Run the DocXR server
`node webServer.js`

7. Open your browser and go to https://localhost:8443/index.html to view the demo.
<br><br><br>
## DocXR Overview
### Web Server
The DocXR web server uses the preferences JSON file to set certain parameters such as port number, avatar colors, and pem file paths; along with permissions to use minified javascript files or compressed assets. Server data is stored in the data directory for pages, users, and worlds.

### Web Client
DocXR uses the Javascript Object Notation (JSON) format to compose and build VR environments. It uses a series of arrow function expressions to define containers, objects, assets, and functions. 
```
'demo=>Environment':{
	'userConcept=>Concept':{model:'concepts/avatar1.json', startPosition:{x:0, y:0, z:0}, startRotation:{x:0, y:0, z:0}},
	'defaults=>Concept':{model:'concepts/defaults.json'},
	'teleport=>Concept':{model:'concepts/teleport.json'},

	'nextButtonMtl=>StandardMaterial':{transparent:true, opacity:1, blending:1, color:0x000000, emissiveIntensity:0, emissive:0x93e20b},
	'nextFontMtl=>BasicMaterial':{color:0xffffff, transparent:true, opacity:1},

	'nextButton=>Group':{handler:'env.nextButtonHandler', object:{visible:true, renderOrder:100, position:{x:0, y:1.51, z:-0.999}, rotation:{x:0, y:0, z:0}, scalar:0.12},
		'0=>TextCell':{align:'center', width:1, lineSpace:0.6, wordSpace:0.15, pad:{top:0.15, left:0.15}, fontSize:0.2, text:'NEXT', backMtl:'env.nextButtonMtl', fontMtl:'env.nextFontMtl', font:'env.defaults.body'}},

	'nextButtonHandler=>Handler':{
		'intersect=>IntersectAction':{
			onFocused:[
				{'current.object.scalar.doAnimation':{from:0.12, to:0.15, fromTime:0, toTime:50}},
				{'env.nextButtonMtl.emissiveIntensity':1},
				{'env.nextFontMtl.color':0x000000}, ],
			onUnfocused:[
				{'current.object.scalar.doAnimation':{from:0.15, to:0.12, fromTime:0, toTime:50}},
				{'env.nextButtonMtl.emissiveIntensity':0},
				{'env.nextFontMtl.color':0xffffff}, ],
			onSelected:[
				{'current.object.scalar.doAnimation':{from:0.15, to:0.12, fromTime:0, toTime:50}},
				{'current.object.scalar.doAnimation':{from:0.12, to:0.15, fromTime:50, toTime:100}},
			],
		},
	},
};
```
Concepts are custom predefined modules that can be reused over multiple environments. The example above has concepts for the avatar, default common assets like fonts, icons, or sounds, and navigation behavior. Object animations can also be defined in the script. The example above contains a button that scales up on hover and scales down on exit. Clicking the button causes the button to scale up and down in 100 milliseconds.

### 3D Model Formats
DocXR supports OBJ, FBX, and GLTF 3D formats. Simple Three JS geometries such as box, circle, cylinder, plane, sphere, and torus are also available for environments.

### 3D Asset Tips
* Assets are automatically preloaded and managed for each environment.
* Bake lights into textures instead of real-time lighting for better VR headset performance.
* Limit the number of vertices on models to optimize VR headset performance.
* Texture resolutions should be sized to powers of two.
* Texture compression is also available using the KTX format to decrease load times.
<br><br><br>
## Additional Information
The [BraincaveXR website](https://braincavexr.com/) has multiple environments and use cases that demonstrate DocXR capabilities. Additional developer documentation with examples for reference can be found in the repository's help directory.


