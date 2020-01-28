// @flow

import type Painter from './painter';
import type SourceCache from '../source/source_cache';
import type StyleLayer from '../style/style_layer';
import type {OverscaledTileID} from '../source/tile_id';
import type SymbolBucket from '../data/bucket/symbol_bucket';
import DepthMode from '../gl/depth_mode';
import StencilMode from '../gl/stencil_mode';
import CullFaceMode from '../gl/cull_face_mode';
import {collisionUniformValues, collisionUniformValuesTemp} from './program/collision_program';

import {CollisionCircleLayoutArray, StructArrayLayout4i8, StructArrayLayout2i4, StructArrayLayout3ui6} from '../data/array_types'
import {collisionCircleLayoutTemp} from '../data/bucket/symbol_attributes';
import SegmentVector from '../data/segment';
import { mat4, vec4 } from 'gl-matrix';

export default drawCollisionDebug;

function drawCollisionDebugGeometry(painter: Painter, sourceCache: SourceCache, layer: StyleLayer, coords: Array<OverscaledTileID>, drawCircles: boolean,
    translate: [number, number], translateAnchor: 'map' | 'viewport', isText: boolean) {
    const context = painter.context;
    const gl = context.gl;
    const program = drawCircles ? painter.useProgram('collisionCircle') : painter.useProgram('collisionBox');

    if (!drawCircles) {
        for (let i = 0; i < coords.length; i++) {
            const coord = coords[i];
            const tile = sourceCache.getTile(coord);
            const bucket: ?SymbolBucket = (tile.getBucket(layer): any);
            if (!bucket) continue;
            const buffers = drawCircles ? (isText ? bucket.textCollisionCircle : bucket.iconCollisionCircle) : (isText ? bucket.textCollisionBox : bucket.iconCollisionBox);
            if (!buffers) continue;
            let posMatrix = coord.posMatrix;
            if (translate[0] !== 0 || translate[1] !== 0) {
                posMatrix = painter.translatePosMatrix(coord.posMatrix, tile, translate, translateAnchor);
            }
            program.draw(context, drawCircles ? gl.TRIANGLES : gl.LINES,
                DepthMode.disabled, StencilMode.disabled,
                painter.colorModeForRenderPass(),
                CullFaceMode.disabled,
                collisionUniformValues(
                    posMatrix,
                    painter.transform,
                    tile),
                layer.id, buffers.layoutVertexBuffer, buffers.indexBuffer,
                buffers.segments, null, painter.transform.zoom, null, null,
                buffers.collisionVertexBuffer);
        }
    }

    // Render collision circles using old-school shader batching with uniform vectors.
    const program2 = painter.useProgram('collisionCircleTemp');

    // Spec defines the minimum size of vec4 array to be 128. If 64 is reserved (equals to 4 matrices)
    // for matrices, then we can safely use the rest. 64 == 128 quads (4 x int16 per quad)
    const maxQuadsPerDrawCall = 64;

    if (!('vertexBuffer2' in layer)) {
        // Use one reusable vertex buffer that contains incremental index values.
        const maxVerticesPerDrawCall = maxQuadsPerDrawCall * 4;
        const array = new StructArrayLayout2i4();

        array.resize(maxVerticesPerDrawCall);
        array._trim();

        for (let i = 0; i < maxVerticesPerDrawCall; i++) {
            array.int16[i * 2 + 0] = i;
            array.int16[i * 2 + 1] = i;
        }

        layer.vertexBuffer2 = context.createVertexBuffer(array, collisionCircleLayoutTemp.members, false);
    }

    if (!('indexBuffer2' in layer)) {
        // TODO: comment
        const maxTrianglesPerDrawCall = maxQuadsPerDrawCall * 2;
        const array = new StructArrayLayout3ui6();

        array.resize(maxTrianglesPerDrawCall);
        array._trim();

        for (let i = 0; i < maxTrianglesPerDrawCall; i++) {
            const idx = i * 6;

            array.uint16[idx + 0] = i * 4 + 0;
            array.uint16[idx + 1] = i * 4 + 1;
            array.uint16[idx + 2] = i * 4 + 2;
            array.uint16[idx + 3] = i * 4 + 2;
            array.uint16[idx + 4] = i * 4 + 3;
            array.uint16[idx + 5] = i * 4 + 0;
        }

        layer.indexBuffer2 = context.createIndexBuffer(array, false);
    }

    // We need to know the projection matrix that was used for projecting collision circles to the screen
    // This might vary between buckets as the symbol placement is a continous process. For improved rendering
    // performance circles with same projection matrix are batched together
    //const tilesPerMatrix = {};

    // Render circle arrays grouped by projection matrices. Blue circles and collided red circles
    // will be rendered in separate batches
    const quadProperties = new Float32Array(maxQuadsPerDrawCall * 4);

    for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];
        const tile = sourceCache.getTile(coord);
        const bucket: ?SymbolBucket = (tile.getBucket(layer): any);
        if (!bucket) continue;

        const arr = bucket.collisionCircleArrayTemp;

        if (!arr.length)
            continue;

        let posMatrix = coord.posMatrix;
        if (translate[0] !== 0 || translate[1] !== 0) {
            posMatrix = painter.translatePosMatrix(coord.posMatrix, tile, translate, translateAnchor);
        }

        // Create a transformation matrix that will transform points from screen space that was used
        // during placement logic to the current screen space
        const batchInvTransform = mat4.multiply([], bucket.invProjMatCircles, painter.transform.glCoordMatrix);
        const batchTransform = posMatrix;// painter.transform.projMatrix.slice();

        //batchTransform[12] = batchTransform[13] = 0.0;

        //mat4.multiply(batchProjMatrix, painter.transform.projMatrix, tilesPerMatrix[key].matrix);
        //mat4.multiply(batchProjMatrix, batchProjMatrix, painter.transform.glCoordMatrix);

        //mat4.multiply(batchProjMatrix, painter.transform.projMatrix, painter.transform.invProjMatrix);
        //mat4.multiply(batchProjMatrix, batchProjMatrix, painter.transform.glCoordMatrix);

        //mat4.multiply(batchProjMatrix, painter.transform.invProjMatrix, painter.transform.glCoordMatrix);
        //mat4.multiply(batchProjMatrix, painter.transform.projMatrix, batchProjMatrix);

        let batchQuadIdx = 0;
        let quadOffset = 0;

        while (quadOffset < arr.length) {
            const quadsLeft = arr.length - quadOffset;
            const quadSpaceInBatch = maxQuadsPerDrawCall - batchQuadIdx;
            const batchSize = Math.min(quadsLeft, quadSpaceInBatch);

            // Copy collision circles from the bucket array
            for (let qIdx = quadOffset; qIdx < quadOffset + batchSize; qIdx++) {
                quadProperties[batchQuadIdx * 4 + 0] = arr.int16[qIdx * 4 + 0]; // width
                quadProperties[batchQuadIdx * 4 + 1] = arr.int16[qIdx * 4 + 1]; // height
                quadProperties[batchQuadIdx * 4 + 2] = arr.int16[qIdx * 4 + 2]; // radius
                quadProperties[batchQuadIdx * 4 + 3] = arr.int16[qIdx * 4 + 3]; // collisionFlag
                batchQuadIdx++;
            }

            quadOffset += batchSize;

            if (batchQuadIdx === maxQuadsPerDrawCall) {
                // TODO: only quad uniforms should be uploaded
                const uniforms = collisionUniformValuesTemp(
                    batchTransform,
                    batchInvTransform,
                    quadProperties,
                    painter.transform);

                // Upload quads packed in uniform vector
                program2.draw(
                    context,
                    gl.TRIANGLES,
                    DepthMode.disabled,
                    StencilMode.disabled,
                    painter.colorModeForRenderPass(),
                    CullFaceMode.disabled,
                    uniforms,
                    layer.id,
                    layer.vertexBuffer2, // layoutVertexBuffer
                    layer.indexBuffer2, // indexbuffer,
                    SegmentVector.simpleSegment(0, 0, batchQuadIdx * 4, batchQuadIdx * 2),
                    null,
                    painter.transform.zoom,
                    null,
                    null, // vertexBuffer
                    null  // vertexBuffer
                );

                batchQuadIdx = 0;
            }
        }

        // Render the leftover batch
        if (batchQuadIdx) {
            // TODO: only quad uniforms should be uploaded
            const uniforms = collisionUniformValuesTemp(
                batchTransform,
                batchInvTransform,
                quadProperties,
                painter.transform);

            // Upload quads packed in uniform vector
            program2.draw(
                context,
                gl.TRIANGLES,
                DepthMode.disabled,
                StencilMode.disabled,
                painter.colorModeForRenderPass(),
                CullFaceMode.disabled,
                uniforms,
                layer.id,
                layer.vertexBuffer2, // layoutVertexBuffer
                layer.indexBuffer2, // indexbuffer,
                SegmentVector.simpleSegment(0, 0, batchQuadIdx * 4, batchQuadIdx * 2),
                null,
                painter.transform.zoom,
                null,
                null, // vertexBuffer
                null  // vertexBuffer
            );
        }
    }
}

function drawCollisionDebug(painter: Painter, sourceCache: SourceCache, layer: StyleLayer, coords: Array<OverscaledTileID>, translate: [number, number], translateAnchor: 'map' | 'viewport', isText: boolean) {
    drawCollisionDebugGeometry(painter, sourceCache, layer, coords, false, translate, translateAnchor, isText);
    //drawCollisionDebugGeometry(painter, sourceCache, layer, coords, true, translate, translateAnchor, isText);
}
