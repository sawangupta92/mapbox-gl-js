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

    // Gather collision circle quads and render them in batches
    let batchQuadIdx = 0;
    const quadProperties = new Float32Array(maxQuadsPerDrawCall * 4);

    for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];
        const tile = sourceCache.getTile(coord);
        const bucket: ?SymbolBucket = (tile.getBucket(layer): any);
        if (!bucket) continue;

        const arr = bucket.collisionCircleArrayTemp;

        if (!arr.length)
            continue;

        let quadOffset = 0;
        while (quadOffset < arr.length) {
            const quadsLeft = arr.length - quadOffset;
            const quadSpaceInBatch = maxQuadsPerDrawCall - batchQuadIdx;
            const batchSize = Math.min(quadsLeft, quadSpaceInBatch);

            // Copy collision circles from the bucket array
            for (let qIdx = quadOffset; qIdx < quadOffset + batchSize; qIdx++) {
                quadProperties[batchQuadIdx * 4 + 0] = arr.int16[qIdx * 6 + 0]; // width
                quadProperties[batchQuadIdx * 4 + 1] = arr.int16[qIdx * 6 + 1]; // height
                quadProperties[batchQuadIdx * 4 + 2] = arr.int16[qIdx * 6 + 2]; // depth
                quadProperties[batchQuadIdx * 4 + 3] = arr.int16[qIdx * 6 + 3]; // radius
                batchQuadIdx++;
            }

            quadOffset += batchSize;

            if (batchQuadIdx === maxQuadsPerDrawCall) {
                // TODO
                const prevInvPosMatrix = coord.posMatrix;
                const posMatrix = coord.posMatrix;

                // TODO: only quad uniforms should be uploaded
                const uniforms = collisionUniformValuesTemp(
                    painter.transform.glCoordMatrix,
                    prevInvPosMatrix,
                    posMatrix,
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
    }

    // Render the leftover batch
    if (batchQuadIdx) {
        // TODO
        const prevInvPosMatrix = new Float32Array(16);
        const posMatrix = new Float32Array(16);

        // TODO: only quad uniforms should be uploaded
        const uniforms = collisionUniformValuesTemp(
            painter.transform.glCoordMatrix,
            prevInvPosMatrix,
            posMatrix,
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

    // // Gather collision circles of tiles and render them in batches
    // const batchVertices = new StructArrayLayout2i4i12();
    // batchVertices.resize(maxVerticesPerBatch);
    // batchVertices._trim();

    // const appendVertex = (idx, x, y, z, w, c) => {
    //     batchVertices.int16[idx * 6 + 0] = x;   // anchor center
    //     batchVertices.int16[idx * 6 + 1] = y;   // anchor center
    //     batchVertices.int16[idx * 6 + 2] = z;   // radius
    //     batchVertices.int16[idx * 6 + 3] = w;   // radius
    //     batchVertices.int16[idx * 6 + 4] = c;   // collision
    //     batchVertices.int16[idx * 6 + 5] = 0;   // reserved
    // }

    // for (let i = 0; i < coords.length; i++) {
    //     const coord = coords[i];
    //     const tile = sourceCache.getTile(coord);
    //     const bucket: ?SymbolBucket = (tile.getBucket(layer): any);
    //     if (!bucket) continue;

    //     const arr = bucket.collisionCircleArrayTemp;

    //     if (!arr.length)
    //         continue;

    //     // Collision circle rendering is a little more complex now that they're stored in screen coordinates.
    //     // Screen space positions of previous frames can be reused by transforming them first to tile space and
    //     // then to the new clip space. Depth information of vertices is not preserved during circle generation
    //     // so it has to be reconstructed in vertex shader
    //     let posMatrix = coord.posMatrix;
    //     if (translate[0] !== 0 || translate[1] !== 0) {
    //         posMatrix = painter.translatePosMatrix(coord.posMatrix, tile, translate, translateAnchor);
    //     }

    //     let prevInvPosMatrix = posMatrix;

    //     if ('posMatrixCircles' in bucket) {
    //         prevInvPosMatrix = mat4.invert([], bucket['posMatrixCircles']);
    //     } else {
    //         prevInvPosMatrix = mat4.invert([], posMatrix);
    //     }

    //     const uniforms = collisionUniformValuesTemp(painter.transform.glCoordMatrix, prevInvPosMatrix,
    //         posMatrix, painter.transform);

    //     // Upload and render quads in batches
    //     let batchVertexIdx = 0;
    //     let vertexOffset = 0;

    //     while (vertexOffset < arr.length) {
    //         const verticesLeft = arr.length - vertexOffset;
    //         const vertexSpaceLeftInBatch = maxVerticesPerBatch - batchVertexIdx;
    //         const batchSize = Math.min(verticesLeft, vertexSpaceLeftInBatch);

    //         for (let vIdx = vertexOffset; vIdx < vertexOffset + batchSize; vIdx+=4) {
    //             const r = arr[vIdx + 2];
    //             const collision = arr[vIdx + 3];
    //             appendVertex(batchVertexIdx + 0, arr[vIdx + 0], arr[vIdx + 1], -r, -r, collision);
    //             appendVertex(batchVertexIdx + 1, arr[vIdx + 0], arr[vIdx + 1], -r, r, collision);
    //             appendVertex(batchVertexIdx + 2, arr[vIdx + 0], arr[vIdx + 1], r, r, collision);
    //             appendVertex(batchVertexIdx + 3, arr[vIdx + 0], arr[vIdx + 1], r, -r, collision);

    //             batchVertexIdx += 4;
    //         }

    //         vertexOffset += batchSize;

    //         // TODO: Proper buffer orphaning. This might currently cause CPU-GPU sync!
    //         if (batchVertexIdx == maxVerticesPerBatch) {
    //             // Render the batch
    //             layer.vertexBuffer2.updateData(batchVertices, 0);

    //             program2.draw(
    //                 context,
    //                 gl.TRIANGLES,
    //                 DepthMode.disabled,
    //                 StencilMode.disabled,
    //                 painter.colorModeForRenderPass(),
    //                 CullFaceMode.disabled,
    //                 uniforms,
    //                 layer.id,
    //                 layer.vertexBuffer2, // layoutVertexBuffer
    //                 layer.indexBuffer2, // indexbuffer,
    //                 SegmentVector.simpleSegment(0, 0, batchVertexIdx, batchVertexIdx / 2),
    //                 null,
    //                 painter.transform.zoom,
    //                 null,
    //                 null, // vertexBuffer
    //                 null  // vertexBuffer
    //             );

    //             batchVertexIdx = 0;
    //         }
    //     }

    //     // Render the leftover branch
    //     if (batchVertexIdx) {
    //         // Render the batch
    //         layer.vertexBuffer2.updateData(batchVertices, 0);

    //         program2.draw(
    //             context,
    //             gl.TRIANGLES,
    //             DepthMode.disabled,
    //             StencilMode.disabled,
    //             painter.colorModeForRenderPass(),
    //             CullFaceMode.disabled,
    //             uniforms,
    //             layer.id,
    //             layer.vertexBuffer2, // layoutVertexBuffer
    //             layer.indexBuffer2, // indexbuffer,
    //             SegmentVector.simpleSegment(0, 0, batchVertexIdx, batchVertexIdx / 2),
    //             null,
    //             painter.transform.zoom,
    //             null,
    //             null, // vertexBuffer
    //             null  // vertexBuffer
    //         );

    //         batchVertexIdx = 0;
    //     }
    // }
}

function drawCollisionDebug(painter: Painter, sourceCache: SourceCache, layer: StyleLayer, coords: Array<OverscaledTileID>, translate: [number, number], translateAnchor: 'map' | 'viewport', isText: boolean) {
    drawCollisionDebugGeometry(painter, sourceCache, layer, coords, false, translate, translateAnchor, isText);
    drawCollisionDebugGeometry(painter, sourceCache, layer, coords, true, translate, translateAnchor, isText);
}
