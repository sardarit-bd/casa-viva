import { model, Schema } from "mongoose";

export const Role = {
    TENANT : 'tenant',
    OWNER: 'owner',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin'
}

const userSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String
    },
    role: {
        type: String,
        default: Role.TENANT
    },

}, {
    timestamps: true,
    versionKey: false
})


export const User = model("User", userSchema)
