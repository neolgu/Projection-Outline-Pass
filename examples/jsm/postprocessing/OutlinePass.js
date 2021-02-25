import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MeshDepthMaterial,
  NoBlending,
  RGBADepthPacking,
  RGBAFormat,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget
} from "../../../build/three.module.js";
import { Pass } from "../postprocessing/Pass.js";
import { CopyShader } from "../shaders/CopyShader.js";

var OutlinePass = function (
  resolution,
  scene,
  camera,
  selectedObjects,
  ignoreObjects,
  mouse
) {
  this.renderScene = scene;
  this.renderCamera = camera;
  this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
  this.ignoreObjects = ignoreObjects !== undefined ? ignoreObjects : [];
  this.mouse = mouse !== undefined ? mouse : new Vector2(0, 0);
  this.visibleEdgeColor = new Color(1, 1, 1);
  this.edgeGlow = 0.0;
  this.edgeThickness = 1.0;
  this.edgeStrength = 3.0;
  this.downSampleRatio = 2;
  this.pulsePeriod = 0;

  this._visibilityCache = new Map();

  Pass.call(this);

  this.resolution =
    resolution !== undefined
      ? new Vector2(resolution.x, resolution.y)
      : new Vector2(256, 256);

  var pars = {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    format: RGBAFormat
  };

  var resx = Math.round(this.resolution.x / this.downSampleRatio);
  var resy = Math.round(this.resolution.y / this.downSampleRatio);

  this.maskBufferMaterial = new MeshBasicMaterial({ color: 0xffffff });
  this.maskBufferMaterial.side = DoubleSide;
  this.renderTargetMaskBuffer = new WebGLRenderTarget(
    this.resolution.x,
    this.resolution.y,
    pars
  );
  this.renderTargetMaskBuffer.texture.name = "OutlinePass.mask";
  this.renderTargetMaskBuffer.texture.generateMipmaps = false;

  this.prepareMaskMaterial = this.getPrepareMaskMaterial();
  this.prepareMaskMaterial.side = DoubleSide;

  this.renderTargetMaskDownSampleBuffer = new WebGLRenderTarget(
    resx,
    resy,
    pars
  );
  this.renderTargetMaskDownSampleBuffer.texture.name =
    "OutlinePass.depthDownSample";
  this.renderTargetMaskDownSampleBuffer.texture.generateMipmaps = false;

  this.renderTargetBlurBuffer1 = new WebGLRenderTarget(resx, resy, pars);
  this.renderTargetBlurBuffer1.texture.name = "OutlinePass.blur1";
  this.renderTargetBlurBuffer1.texture.generateMipmaps = false;
  this.renderTargetBlurBuffer2 = new WebGLRenderTarget(
    Math.round(resx / 2),
    Math.round(resy / 2),
    pars
  );
  this.renderTargetBlurBuffer2.texture.name = "OutlinePass.blur2";
  this.renderTargetBlurBuffer2.texture.generateMipmaps = false;

  this.edgeDetectionMaterial = this.getEdgeDetectionMaterial();
  this.renderTargetEdgeBuffer1 = new WebGLRenderTarget(resx, resy, pars);
  this.renderTargetEdgeBuffer1.texture.name = "OutlinePass.edge1";
  this.renderTargetEdgeBuffer1.texture.generateMipmaps = false;
  this.renderTargetEdgeBuffer2 = new WebGLRenderTarget(
    Math.round(resx / 2),
    Math.round(resy / 2),
    pars
  );
  this.renderTargetEdgeBuffer2.texture.name = "OutlinePass.edge2";
  this.renderTargetEdgeBuffer2.texture.generateMipmaps = false;

  var MAX_EDGE_THICKNESS = 4;
  var MAX_EDGE_GLOW = 4;

  this.separableBlurMaterial1 = this.getSeperableBlurMaterial(
    MAX_EDGE_THICKNESS
  );
  this.separableBlurMaterial1.uniforms["texSize"].value.set(resx, resy);
  this.separableBlurMaterial1.uniforms["kernelRadius"].value = 1;
  this.separableBlurMaterial2 = this.getSeperableBlurMaterial(MAX_EDGE_GLOW);
  this.separableBlurMaterial2.uniforms["texSize"].value.set(
    Math.round(resx / 2),
    Math.round(resy / 2)
  );
  this.separableBlurMaterial2.uniforms["kernelRadius"].value = MAX_EDGE_GLOW;

  // Overlay material
  this.overlayMaterial = this.getOverlayMaterial();

  // copy material
  if (CopyShader === undefined)
    console.error("THREE.OutlinePass relies on CopyShader");

  var copyShader = CopyShader;

  this.copyUniforms = UniformsUtils.clone(copyShader.uniforms);
  this.copyUniforms["opacity"].value = 1.0;

  this.materialCopy = new ShaderMaterial({
    uniforms: this.copyUniforms,
    vertexShader: copyShader.vertexShader,
    fragmentShader: copyShader.fragmentShader,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true
  });

  this.enabled = true;
  this.needsSwap = false;

  this._oldClearColor = new Color();
  this.oldClearAlpha = 1;

  this.fsQuad = new Pass.FullScreenQuad(null);

  this.tempPulseColor1 = new Color();
  this.textureMatrix = new Matrix4();

  this.floodFill = floodFill;

  function floodFill(x, y, pixelData, width, height) {
    var pixel_stack = [{ x: x, y: y }];
    var pixels = pixelData;
    var linear_cords = (y * width + x) * 4;

    var original_color = {
      r: pixels[linear_cords],
      g: pixels[linear_cords + 1],
      b: pixels[linear_cords + 2],
      a: pixels[linear_cords + 3]
    };

    var color = {
      r: 0,
      g: 0,
      b: 255,
      a: 255
    };

    while (pixel_stack.length > 0) {
      var new_pixel = pixel_stack.shift();
      x = new_pixel.x;
      y = new_pixel.y;

      linear_cords = (y * width + x) * 4;
      while (y-- >= 0 && pixels[linear_cords + 1] == original_color.g) {
        linear_cords -= width * 4;
      }
      linear_cords += width * 4;
      y++;

      var reached_left = false;
      var reached_right = false;
      while (y++ < height && pixels[linear_cords + 1] == original_color.g) {
        pixels[linear_cords] = color.r;
        pixels[linear_cords + 1] = color.g;
        pixels[linear_cords + 2] = color.b;
        pixels[linear_cords + 3] = color.a;

        if (x > 0) {
          if (
            pixels[linear_cords - 4] == original_color.r &&
            pixels[linear_cords - 4 + 1] == original_color.g
          ) {
            if (!reached_left) {
              pixel_stack.push({ x: x - 1, y: y });
              reached_left = true;
            }
          } else if (reached_left) {
            reached_left = false;
          }
        }

        if (x < width - 1) {
          if (
            pixels[linear_cords + 4] == original_color.r &&
            pixels[linear_cords + 4 + 1] == original_color.g
          ) {
            if (!reached_right) {
              pixel_stack.push({ x: x + 1, y: y });
              reached_right = true;
            }
          } else if (reached_right) {
            reached_right = false;
          }
        }
        linear_cords += width * 4;
      }
    }
  }
};

OutlinePass.prototype = Object.assign(Object.create(Pass.prototype), {
  constructor: OutlinePass,

  dispose: function () {
    this.renderTargetMaskBuffer.dispose();
    this.renderTargetMaskDownSampleBuffer.dispose();
    this.renderTargetBlurBuffer1.dispose();
    this.renderTargetBlurBuffer2.dispose();
    this.renderTargetEdgeBuffer1.dispose();
    this.renderTargetEdgeBuffer2.dispose();
  },

  setSize: function (width, height) {
    this.renderTargetMaskBuffer.setSize(width, height);

    var resx = Math.round(width / this.downSampleRatio);
    var resy = Math.round(height / this.downSampleRatio);
    this.renderTargetMaskDownSampleBuffer.setSize(resx, resy);
    this.renderTargetBlurBuffer1.setSize(resx, resy);
    this.renderTargetEdgeBuffer1.setSize(resx, resy);
    this.separableBlurMaterial1.uniforms["texSize"].value.set(resx, resy);

    resx = Math.round(resx / 2);
    resy = Math.round(resy / 2);

    this.renderTargetBlurBuffer2.setSize(resx, resy);
    this.renderTargetEdgeBuffer2.setSize(resx, resy);

    this.separableBlurMaterial2.uniforms["texSize"].value.set(resx, resy);
  },

  changeVisibilityOfSelectedObjects: function (bVisible) {
    var cache = this._visibilityCache;

    function gatherSelectedMeshesCallBack(object) {
      if (object.isMesh) {
        if (bVisible === true) {
          object.visible = cache.get(object);
        } else {
          cache.set(object, object.visible);
          object.visible = bVisible;
        }
      }
    }

    for (var i = 0; i < this.selectedObjects.length; i++) {
      var selectedObject = this.selectedObjects[i];
      selectedObject.traverse(gatherSelectedMeshesCallBack);
    }
  },

  changeVisibilityOfNonSelectedObjects: function (bVisible) {
    var cache = this._visibilityCache;
    var selectedMeshes = [];

    function gatherSelectedMeshesCallBack(object) {
      if (object.isMesh) selectedMeshes.push(object);
    }

    for (var i = 0; i < this.selectedObjects.length; i++) {
      var selectedObject = this.selectedObjects[i];
      selectedObject.traverse(gatherSelectedMeshesCallBack);
    }

    function VisibilityChangeCallBack(object) {
      if (object.isMesh || object.isSprite) {
        // only meshes and sprites are supported by OutlinePass

        var bFound = false;

        for (var i = 0; i < selectedMeshes.length; i++) {
          var selectedObjectId = selectedMeshes[i].id;

          if (selectedObjectId === object.id) {
            bFound = true;
            break;
          }
        }

        if (bFound === false) {
          var visibility = object.visible;

          if (bVisible === false || cache.get(object) === true) {
            object.visible = bVisible;
          }

          cache.set(object, visibility);
        }
      } else if (object.isPoints || object.isLine) {
        // the visibilty of points and lines is always set to false in order to
        // not affect the outline computation

        if (bVisible === true) {
          object.visible = cache.get(object); // restore
        } else {
          cache.set(object, object.visible);
          object.visible = bVisible;
        }
      }
    }

    this.renderScene.traverse(VisibilityChangeCallBack);
  },

  updateTextureMatrix: function () {
    this.textureMatrix.set(
      0.5,
      0.0,
      0.0,
      0.5,
      0.0,
      0.5,
      0.0,
      0.5,
      0.0,
      0.0,
      0.5,
      0.5,
      0.0,
      0.0,
      0.0,
      1.0
    );
    this.textureMatrix.multiply(this.renderCamera.projectionMatrix);
    this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse);
  },

  render: function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (this.selectedObjects.length > 0) {
      renderer.getClearColor(this._oldClearColor);
      this.oldClearAlpha = renderer.getClearAlpha();
      var oldAutoClear = renderer.autoClear;

      renderer.autoClear = false;

      if (maskActive) renderer.state.buffers.stencil.setTest(false);

      renderer.setClearColor(0xffffff, 1);

      var currentBackground = this.renderScene.background;
      this.renderScene.background = null;

      this.renderScene.overrideMaterial = this.prepareMaskMaterial;

      // XXXXchange visibility SELECTED OBJECTXXXX  <- TODO: ignore object invisible

      renderer.setRenderTarget(this.renderTargetMaskBuffer);
      renderer.clear();
      renderer.render(this.renderScene, this.renderCamera);

      this.renderScene.background = currentBackground;
      this.renderScene.overrideMaterial = null;

      // Downsample to Half resolution
      this.fsQuad.material = this.materialCopy;
      this.copyUniforms["tDiffuse"].value = this.renderTargetMaskBuffer.texture;
      renderer.setRenderTarget(this.renderTargetMaskDownSampleBuffer);
      renderer.clear();
      this.fsQuad.render(renderer);

      // flood fill with randertarget buffer
      var maskBufferSize = this.renderTargetMaskDownSampleBuffer;
      var pixelBuffer = new Uint8Array(
        maskBufferSize.width * maskBufferSize.height * 4 * 4
      );
      renderer.readRenderTargetPixels(
        this.renderTargetMaskDownSampleBuffer,
        0,
        0,
        maskBufferSize.width,
        maskBufferSize.height,
        pixelBuffer
      );
      this.floodFill(
        parseInt(this.mouse.x / 2),
        maskBufferSize.height - parseInt(this.mouse.y / 2),
        pixelBuffer,
        maskBufferSize.width,
        maskBufferSize.height
      );
      var expandTexture = new DataTexture(
        pixelBuffer,
        maskBufferSize.width,
        maskBufferSize.height,
        RGBAFormat
      );

      // pulse
      this.tempPulseColor1.copy(this.visibleEdgeColor);

      if (this.pulsePeriod > 0) {
        var scalar =
          (1 + 0.25) / 2 +
          (Math.cos((performance.now() * 0.01) / this.pulsePeriod) *
            (1.0 - 0.25)) /
            2;
        this.tempPulseColor1.multiplyScalar(scalar);
      }

      // Apply Edge Detection Pass
      this.fsQuad.material = this.edgeDetectionMaterial;
      this.edgeDetectionMaterial.uniforms["maskTexture"].value = expandTexture;
      this.edgeDetectionMaterial.uniforms["texSize"].value.set(
        this.renderTargetMaskDownSampleBuffer.width,
        this.renderTargetMaskDownSampleBuffer.height
      );
      this.edgeDetectionMaterial.uniforms[
        "visibleEdgeColor"
      ].value = this.tempPulseColor1;
      renderer.setRenderTarget(this.renderTargetEdgeBuffer1);
      renderer.clear();
      this.fsQuad.render(renderer);

      // Apply Blur on Half res
      this.fsQuad.material = this.separableBlurMaterial1;
      this.separableBlurMaterial1.uniforms[
        "colorTexture"
      ].value = this.renderTargetEdgeBuffer1.texture;
      this.separableBlurMaterial1.uniforms["direction"].value =
        OutlinePass.BlurDirectionX;
      this.separableBlurMaterial1.uniforms[
        "kernelRadius"
      ].value = this.edgeThickness;
      renderer.setRenderTarget(this.renderTargetBlurBuffer1);
      renderer.clear();
      this.fsQuad.render(renderer);
      this.separableBlurMaterial1.uniforms[
        "colorTexture"
      ].value = this.renderTargetBlurBuffer1.texture;
      this.separableBlurMaterial1.uniforms["direction"].value =
        OutlinePass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetEdgeBuffer1);
      renderer.clear();
      this.fsQuad.render(renderer);

      // Apply Blur on quarter res
      this.fsQuad.material = this.separableBlurMaterial2;
      this.separableBlurMaterial2.uniforms[
        "colorTexture"
      ].value = this.renderTargetEdgeBuffer1.texture;
      this.separableBlurMaterial2.uniforms["direction"].value =
        OutlinePass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetBlurBuffer2);
      renderer.clear();
      this.fsQuad.render(renderer);
      this.separableBlurMaterial2.uniforms[
        "colorTexture"
      ].value = this.renderTargetBlurBuffer2.texture;
      this.separableBlurMaterial2.uniforms["direction"].value =
        OutlinePass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetEdgeBuffer2);
      renderer.clear();
      this.fsQuad.render(renderer);

      // Blend it additively over the input texture
      this.fsQuad.material = this.overlayMaterial;
      this.overlayMaterial.uniforms[
        "maskTexture"
      ].value = this.renderTargetMaskBuffer.texture;
      this.overlayMaterial.uniforms[
        "edgeTexture1"
      ].value = this.renderTargetEdgeBuffer1.texture;
      this.overlayMaterial.uniforms[
        "edgeTexture2"
      ].value = this.renderTargetEdgeBuffer2.texture;
      this.overlayMaterial.uniforms["edgeStrength"].value = this.edgeStrength;
      this.overlayMaterial.uniforms["edgeGlow"].value = this.edgeGlow;

      if (maskActive) renderer.state.buffers.stencil.setTest(true);

      renderer.setRenderTarget(readBuffer);
      this.fsQuad.render(renderer);

      renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
      renderer.autoClear = oldAutoClear;
    }

    if (this.renderToScreen) {
      this.fsQuad.material = this.materialCopy;
      this.copyUniforms["tDiffuse"].value = readBuffer.texture;
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    }
  },

  getPrepareMaskMaterial: function () {
    return new ShaderMaterial({
      vertexShader: [
        "void main() {",
        "	#include <begin_vertex>",
        "	#include <project_vertex>",

        "}"
      ].join("\n"),

      fragmentShader: [
        "void main() {",

        "	gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);",

        "}"
      ].join("\n")
    });
  },

  getEdgeDetectionMaterial: function () {
    return new ShaderMaterial({
      uniforms: {
        maskTexture: { value: null },
        texSize: { value: new Vector2(0.5, 0.5) },
        visibleEdgeColor: { value: new Vector3(1.0, 1.0, 1.0) }
      },

      vertexShader:
        "varying vec2 vUv;\n\
				void main() {\n\
					vUv = uv;\n\
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n\
				}",

      fragmentShader:
        "varying vec2 vUv;\
				uniform sampler2D maskTexture;\
				uniform vec2 texSize;\
				uniform vec3 visibleEdgeColor;\
				\
				void main() {\n\
					vec2 invSize = 1.0 / texSize;\
					vec4 uvOffset = vec4(0.7, 0.0, 0.0, 0.7) * vec4(invSize, invSize);\
					vec4 c1 = texture2D( maskTexture, vUv + uvOffset.xy);\
					vec4 c2 = texture2D( maskTexture, vUv - uvOffset.xy);\
					vec4 c3 = texture2D( maskTexture, vUv + uvOffset.yw);\
					vec4 c4 = texture2D( maskTexture, vUv - uvOffset.yw);\
					float diff1 = (c1.r - c2.r)*0.5;\
					float diff2 = (c3.r - c4.r)*0.5;\
					float d = length( vec2(diff1, diff2) );\
					vec3 edgeColor = visibleEdgeColor;\
					gl_FragColor = vec4(edgeColor, 1.0) * vec4(d);\
				}"
    });
  },

  getSeperableBlurMaterial: function (maxRadius) {
    return new ShaderMaterial({
      defines: {
        MAX_RADIUS: maxRadius
      },

      uniforms: {
        colorTexture: { value: null },
        texSize: { value: new Vector2(0.5, 0.5) },
        direction: { value: new Vector2(0.5, 0.5) },
        kernelRadius: { value: 1.0 }
      },

      vertexShader:
        "varying vec2 vUv;\n\
				void main() {\n\
					vUv = uv;\n\
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n\
				}",

      fragmentShader:
        "#include <common>\
				varying vec2 vUv;\
				uniform sampler2D colorTexture;\
				uniform vec2 texSize;\
				uniform vec2 direction;\
				uniform float kernelRadius;\
				\
				float gaussianPdf(in float x, in float sigma) {\
					return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;\
				}\
				void main() {\
					vec2 invSize = 1.0 / texSize;\
					float weightSum = gaussianPdf(0.0, kernelRadius);\
					vec4 diffuseSum = texture2D( colorTexture, vUv) * weightSum;\
					vec2 delta = direction * invSize * kernelRadius/float(MAX_RADIUS);\
					vec2 uvOffset = delta;\
					for( int i = 1; i <= MAX_RADIUS; i ++ ) {\
						float w = gaussianPdf(uvOffset.x, kernelRadius);\
						vec4 sample1 = texture2D( colorTexture, vUv + uvOffset);\
						vec4 sample2 = texture2D( colorTexture, vUv - uvOffset);\
						diffuseSum += ((sample1 + sample2) * w);\
						weightSum += (2.0 * w);\
						uvOffset += delta;\
					}\
					gl_FragColor = diffuseSum/weightSum;\
				}"
    });
  },

  getOverlayMaterial: function () {
    return new ShaderMaterial({
      uniforms: {
        maskTexture: { value: null },
        edgeTexture1: { value: null },
        edgeTexture2: { value: null },
        edgeStrength: { value: 1.0 },
        edgeGlow: { value: 1.0 }
      },

      vertexShader:
        "varying vec2 vUv;\n\
				void main() {\n\
					vUv = uv;\n\
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n\
				}",

      fragmentShader:
        "varying vec2 vUv;\
				uniform sampler2D maskTexture;\
				uniform sampler2D edgeTexture1;\
				uniform sampler2D edgeTexture2;\
				uniform float edgeStrength;\
				uniform float edgeGlow;\
				\
				void main() {\
					vec4 edgeValue1 = texture2D(edgeTexture1, vUv);\
					vec4 edgeValue2 = texture2D(edgeTexture2, vUv);\
					vec4 maskColor = texture2D(maskTexture, vUv);\
					float visibilityFactor = 1.0 - maskColor.g > 0.0 ? 1.0 : 0.5;\
					vec4 edgeValue = edgeValue1 + edgeValue2 * edgeGlow;\
					vec4 finalColor = edgeStrength * maskColor.r * edgeValue;\
					gl_FragColor = finalColor;\
				}",
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
  }
});

OutlinePass.BlurDirectionX = new Vector2(1.0, 0.0);
OutlinePass.BlurDirectionY = new Vector2(0.0, 1.0);

export { OutlinePass };
